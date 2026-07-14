mod commands;
pub mod execution;
pub mod db;

use db::Db;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_dialog::DialogExt;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

/// Per-repository execution lock registry.
/// Prevents concurrent Git operations on the same repository.
#[derive(Clone)]
pub struct ExecutionLocks(std::sync::Arc<std::sync::Mutex<std::collections::HashMap<i64, std::sync::Arc<std::sync::Mutex<()>>>>>);

impl ExecutionLocks {
    pub fn new() -> Self {
        Self(std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())))
    }

    /// Get or create a lock for the given repository ID.
    pub fn get_lock(&self, repo_id: i64) -> std::sync::Arc<std::sync::Mutex<()>> {
        let mut map = self.0.lock().unwrap();
        map.entry(repo_id)
            .or_insert_with(|| std::sync::Arc::new(std::sync::Mutex::new(())))
            .clone()
    }
}

#[cfg(test)]
mod lock_tests {
    use super::ExecutionLocks;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn same_repository_lock_serializes_mutation_boundary() {
        let locks = ExecutionLocks::new();
        let first = locks.get_lock(1);
        let guard = first.lock().unwrap();
        let second = locks.get_lock(1);
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let _guard = second.lock().unwrap();
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(std::time::Duration::from_millis(50)).is_err());
        drop(guard);
        assert!(rx.recv_timeout(std::time::Duration::from_secs(1)).is_ok());
        handle.join().unwrap();
    }

    #[test]
    fn different_repository_locks_do_not_block_each_other() {
        let locks = ExecutionLocks::new();
        let first = locks.get_lock(1);
        let _guard = first.lock().unwrap();
        let second = locks.get_lock(2);
        assert!(second.try_lock().is_ok());
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn handle_missed_schedules(db: &Db, notifier: Option<&dyn Fn(&str, &str)>) {
    let now = now_secs();
    let overdue_items = {
        let conn = db.0.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT qi.id, qi.title, qi.scheduled_time
             FROM queue_items qi
             WHERE qi.status = 'Scheduled' AND qi.scheduled_time < ?1"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = stmt.query_map([now], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        }).and_then(|rs| {
            let mut items = Vec::new();
            for r in rs {
                items.push(r?);
            }
            Ok(items)
        });
        rows.unwrap_or_default()
    };

    if overdue_items.is_empty() {
        return;
    }

    let policy = db.get_missed_schedule_policy();
    let item_ids: Vec<i64> = overdue_items.iter().map(|(id, _, _)| *id).collect();

    match policy.as_str() {
        "skip" => {
            let _ = db.mark_items_skipped(&item_ids);
            for (id, title, _) in &overdue_items {
                let _ = db.add_activity_event(
                    "warning", None, Some(*id),
                    "missed_schedule_skipped",
                    &format!("Missed schedule for '{}' was skipped.", title),
                    None,
                );
            }
            if let Some(f) = notifier {
                f(
                    "Missed Schedule",
                    &format!("{} missed commits were skipped.", overdue_items.len()),
                );
            }
        }
        "ask" => {
            let _ = db.mark_items_paused(&item_ids, "MISSED_SCHEDULE: Pending user decision");
            for (id, title, _) in &overdue_items {
                let _ = db.add_activity_event(
                    "warning", None, Some(*id),
                    "missed_schedule_paused",
                    &format!("Missed schedule for '{}' paused. Pending user decision.", title),
                    None,
                );
            }
            if let Some(f) = notifier {
                f(
                    "Missed Schedule",
                    &format!("{} missed commits require review.", overdue_items.len()),
                );
            }
        }
        "redistribute" => {
            let mut sorted = overdue_items.clone();
            sorted.sort_by_key(|(_, _, t)| *t);

            if let Some((_, _, first_t)) = sorted.first() {
                let target_start = now + 60;
                let shift = target_start - *first_t;
                let _ = db.shift_scheduled_times(&item_ids, shift);
                for (id, title, old_t) in &sorted {
                    let new_t = old_t + shift;
                    let _ = db.add_activity_event(
                        "info", None, Some(*id),
                        "missed_schedule_redistributed",
                        &format!("Redistributed '{}' from {} to {}.", title, old_t, new_t),
                        None,
                    );
                }
                if let Some(f) = notifier {
                    f(
                        "Missed Schedule",
                        &format!("{} missed commits redistributed to new times.", overdue_items.len()),
                    );
                }
            }
        }
        _ => {
            // "run_immediately" (default): Do nothing, let background scheduler loop execute them.
            for (id, title, _) in &overdue_items {
                let _ = db.add_activity_event(
                    "info", None, Some(*id),
                    "missed_schedule_run_immediately",
                    &format!("Missed schedule for '{}' will run immediately.", title),
                    None,
                );
            }
        }
    }
}

pub fn tick_scheduler(db: &Db, locks: &ExecutionLocks, notifier: Option<&dyn Fn(&str, &str)>) {
    let now = now_secs();
    let due_items = match db.get_due_items(now) {
        Ok(items) => items,
        Err(e) => {
            eprintln!("Error fetching due items: {:?}", e);
            return;
        }
    };

    if due_items.is_empty() {
        return;
    }

    // Group due items by repository_id to serialize execution
    let mut groups: std::collections::HashMap<i64, Vec<db::DueItemInfo>> = std::collections::HashMap::new();
    for item in due_items {
        // Check backoff constraint if retry_count > 0
        if item.retry_count > 0 {
            let elapsed = now - item.updated_at;
            let backoff = match item.retry_count {
                1 => 30,
                2 => 120,
                _ => 300,
            };
            if elapsed < backoff {
                continue;
            }
        }
        groups.entry(item.repository_id).or_default().push(item);
    }

    for (_repo_id, items) in groups {
        if items.is_empty() {
            continue;
        }

        // If the first item is a PushPending retry, we execute it and stop processing for this repo this tick
        if items[0].status == "PushPending" {
            let first = &items[0];
            let repo_path = &first.repository_path;
            match execution::execute_item(db, locks, first.id, repo_path) {
                Ok(hash) => {
                    if let Some(f) = notifier {
                        f(
                            "GitOutbox Success",
                            &format!("Successfully pushed retry commit {}", &hash[..7]),
                        );
                    }
                }
                Err(err) => {
                    if let Some(f) = notifier {
                        f(
                            "GitOutbox Error",
                            &format!("Push retry failed: {}", err),
                        );
                    }
                }
            }
            continue;
        }

        // Loop through Scheduled items sequentially
        let mut idx = 0;
        while idx < items.len() {
            let item = &items[idx];
            if item.status != "Scheduled" {
                idx += 1;
                continue;
            }
            let repo_path = &item.repository_path;

            if item.execution_mode == "push_at_end" {
                // Collect contiguous push_at_end items
                let mut batch_ids = Vec::new();
                for j in idx..items.len() {
                    if items[j].status == "Scheduled" && items[j].execution_mode == "push_at_end" {
                        batch_ids.push(items[j].id);
                    } else {
                        break;
                    }
                }
                if !batch_ids.is_empty() {
                    let count = batch_ids.len();
                    match execution::execute_batch(db, locks, &batch_ids, repo_path) {
                        Ok(committed) => {
                            if let Some(f) = notifier {
                                f(
                                    "GitOutbox Success",
                                    &format!("Successfully committed and pushed batch of {} items", committed.len()),
                                );
                            }
                            idx += count;
                        }
                        Err(err) => {
                            if let Some(f) = notifier {
                                f(
                                    "GitOutbox Error",
                                    &format!("Batch execution failed: {}", err),
                                );
                            }
                            // Abort subsequent items for this repository to prevent safety issues
                            break;
                        }
                    }
                } else {
                    idx += 1;
                }
            } else {
                match execution::execute_item(db, locks, item.id, repo_path) {
                    Ok(hash) => {
                        if let Some(f) = notifier {
                            f(
                                "GitOutbox Success",
                                &format!("Successfully completed scheduled commit {}", &hash[..7]),
                            );
                        }
                        idx += 1;
                    }
                    Err(err) => {
                        if let Some(f) = notifier {
                            f(
                                "GitOutbox Error",
                                &format!("Scheduled commit failed: {}", err),
                            );
                        }
                        // Abort subsequent items for this repository
                        break;
                    }
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("gitoutbox.db"))?;

            // Reconcile each stale item against its own persisted repository.
            if let Ok(reconciled) = db.reconcile_all_on_startup() {
                for (item_id, new_status) in &reconciled {
                    let _ = db.add_activity_event(
                        "info", None, Some(*item_id),
                        "reconciliation_completed",
                        &format!("Reconciled item {item_id}: → {new_status}"),
                        None,
                    );
                }
            }

            // Run missed schedule policy reconciliation on startup
            let app_handle = app.handle().clone();
            let app_handle_clone = app_handle.clone();
            let notifier = move |title: &str, body: &str| {
                let _ = app_handle_clone.notification()
                    .builder()
                    .title(title)
                    .body(body)
                    .show();
            };
            handle_missed_schedules(&db, Some(&notifier));

            // System tray icon setup
            let show_i = MenuItemBuilder::with_id("show", "Show GitOutbox").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_i, &quit_i])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("GitOutbox — prepare work now, ship it on your schedule.")
                .icon(app.default_window_icon().unwrap().clone())
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            app.on_menu_event(move |app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    let db = app.state::<Db>();
                    let has_active = {
                        if let Ok(conn) = db.0.lock() {
                            let count: i64 = conn.query_row(
                                "SELECT COUNT(*) FROM queue_items WHERE status IN ('Scheduled', 'Validating', 'Staging', 'Committing', 'Pushing')",
                                [],
                                |r| r.get(0),
                            ).unwrap_or(0);
                            count > 0
                        } else {
                            false
                        }
                    };
                    
                    if has_active {
                        let confirm = app.dialog()
                            .message("Scheduled work is active. Exiting GitOutbox will pause scheduled commits until the app runs again.")
                            .title("Scheduled work is active")
                            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
                            .blocking_show();
                        if confirm {
                            app.exit(0);
                        }
                    } else {
                        app.exit(0);
                    }
                }
                _ => {}
            });

            let db_clone = db.clone();
            let locks = ExecutionLocks::new();
            let locks_clone = locks.clone();
            
            app.manage(db);
            app.manage(locks);

            // Spawn the scheduler loop
            let app_handle_clone2 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let loop_notifier = move |title: &str, body: &str| {
                    let _ = app_handle_clone2.notification()
                        .builder()
                        .title(title)
                        .body(body)
                        .show();
                };
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    tick_scheduler(&db_clone, &locks_clone, Some(&loop_notifier));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::git_check,
            commands::inspect_repository,
            commands::get_status,
            commands::add_repository,
            commands::list_repositories,
            commands::remove_repository,
            commands::count_draft_items,
            commands::list_templates,
            commands::create_template,
            commands::update_template,
            commands::duplicate_template,
            commands::delete_template,
            commands::create_queue_item,
            commands::batch_create_queue_items,
            commands::get_queue_item,
            commands::list_queue_items,
            commands::list_assigned_files,
            commands::check_file_conflicts,
            commands::update_queue_item,
            commands::update_queue_item_full,
            commands::remove_queue_item,
            commands::open_in_explorer,
            commands::schedule_items,
            commands::unschedule_items,
            commands::list_scheduled_items,
            commands::list_all_scheduled_items,
            commands::execute_item,
            commands::execute_batch,
            commands::reschedule_item,
            commands::capture_fingerprints,
            commands::list_activity_events,
            commands::get_execution_mode,
            commands::set_execution_mode,
            commands::get_missed_schedule_policy,
            commands::set_missed_schedule_policy,
            commands::compute_schedule,
            commands::count_scheduled_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitOutbox");
}

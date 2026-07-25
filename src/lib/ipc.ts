// Typed wrappers over the Rust IPC commands (src-tauri/src/commands.rs).
// React never runs Git directly — it only invokes these commands.
import { invoke } from "@tauri-apps/api/core";

export type ChangeType = "untracked" | "modified" | "deleted" | "renamed";

export interface Change {
  path: string;
  filename: string;
  directory: string;
  original_path: string | null;
  change_type: ChangeType;
  staged: boolean;
}

export interface GitCheck {
  installed: boolean;
  version: string | null;
  git_path: string | null;
  user_name: string | null;
  user_email: string | null;
  default_branch: string | null;
}

export interface RepoStatus {
  path: string;
  current_branch: string | null;
  operation_in_progress: string | null;
  changes: Change[];
}

export interface Repository {
  id: number;
  path: string;
  name: string;
  created_at: number;
}

export interface QueueItemFile {
  path: string;
  original_path: string | null;
  change_type: ChangeType;
}

export interface QueueItem {
  id: number;
  queue_id: number;
  title: string;
  commit_message: string;
  target_branch: string;
  execution_mode: string;
  status: string;
  scheduled_time: number | null;
  commit_hash: string | null;
  last_error: string | null;
  files: QueueItemFile[];
  updated_at: number;
}

export interface Template {
  name: string;
  template: string;
}

export interface AddRepositoryResult {
  repository: Repository;
  already_exists: boolean;
}

export interface AssignedFile {
  path: string;
  item_id: number;
  commit_message: string;
}

export interface BatchItem {
  title: string;
  commit_message: string;
  files: QueueItemFile[];
}

export interface BatchResult {
  created_ids: number[];
  count: number;
}

export interface FileConflict {
  path: string;
  existing_item_id: number;
  existing_message: string;
}

export interface ScheduleAssignment {
  item_id: number;
  scheduled_time: number;
}

export interface ActivityEvent {
  id: number;
  ts: number;
  level: string;
  repository_id: number | null;
  queue_item_id: number | null;
  event_type: string;
  message: string;
  metadata: string | null;
  commit_message: string | null;
  commit_hash: string | null;
}

export const api = {
  gitCheck: () => invoke<GitCheck>("git_check"),
  inspectRepository: (path: string) =>
    invoke<RepoStatus>("inspect_repository", { path }),
  getStatus: (path: string) => invoke<Change[]>("get_status", { path }),
  addRepository: (path: string) =>
    invoke<AddRepositoryResult>("add_repository", { path }),
  listRepositories: () => invoke<Repository[]>("list_repositories"),
  removeRepository: (id: number) => invoke<void>("remove_repository", { id }),
  countDraftItems: (repository_id: number) =>
    invoke<number>("count_draft_items", { repository_id }),

  listTemplates: () => invoke<Template[]>("list_templates"),
  createTemplate: (name: string, template: string) =>
    invoke<void>("create_template", { name, template }),
  updateTemplate: (name: string, template: string) =>
    invoke<void>("update_template", { name, template }),
  duplicateTemplate: (source_name: string) =>
    invoke<string>("duplicate_template", { source_name }),
  deleteTemplate: (name: string) => invoke<void>("delete_template", { name }),

  createQueueItem: (args: {
    repository_id: number;
    target_branch: string;
    files: QueueItemFile[];
    title: string;
    commit_message: string;
  }) => invoke<number>("create_queue_item", args),

  batchCreateQueueItems: (
    repository_id: number,
    target_branch: string,
    items: BatchItem[]
  ) => invoke<BatchResult>("batch_create_queue_items", {
    repository_id,
    target_branch,
    items,
  }),

  getQueueItem: (id: number) =>
    invoke<QueueItem>("get_queue_item", { id }),

  listQueueItems: (repository_id: number) =>
    invoke<QueueItem[]>("list_queue_items", { repository_id }),

  listAssignedFiles: (repository_id: number) =>
    invoke<AssignedFile[]>("list_assigned_files", { repository_id }),

  checkFileConflicts: (repository_id: number, paths: string[]) =>
    invoke<FileConflict[]>("check_file_conflicts", { repository_id, paths }),

  updateQueueItem: (id: number, title: string, commit_message: string) =>
    invoke<void>("update_queue_item", { id, title, commit_message }),

  updateQueueItemFull: (
    id: number,
    commit_message: string,
    target_branch: string,
    files: QueueItemFile[]
  ) => invoke<void>("update_queue_item_full", {
    id,
    commit_message,
    target_branch,
    files,
  }),

  removeQueueItem: (id: number) => invoke<void>("remove_queue_item", { id }),

  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),

  scheduleItems: (repository_id: number, assignments: ScheduleAssignment[], repo_path: string) =>
    invoke<void>("schedule_items", { repository_id, assignments, repo_path }),

  unscheduleItems: (item_ids: number[]) =>
    invoke<void>("unschedule_items", { item_ids }),

  listScheduledItems: (repository_id: number, from_time: number, to_time: number) =>
    invoke<QueueItem[]>("list_scheduled_items", { repository_id, from_time, to_time }),

  listAllScheduledItems: (from_time?: number, to_time?: number) =>
    invoke<QueueItem[]>("list_all_scheduled_items", { from_time, to_time }),

  executeItem: (item_id: number, repository_path: string) =>
    invoke<string>("execute_item", { item_id, repository_path }),

  executeBatch: (item_ids: number[], repository_path: string) =>
    invoke<[number, string][]>("execute_batch", { item_ids, repository_path }),

  rescheduleItem: (item_id: number, new_time: number) =>
    invoke<void>("reschedule_item", { item_id, new_time }),

  retryPausedItems: (item_ids: number[], repository_path: string) =>
    invoke<void>("retry_paused_items", { item_ids, repository_path }),

  captureFingerprints: (item_id: number, repository_path: string) =>
    invoke<void>("capture_fingerprints", { item_id, repository_path }),

  listActivityEvents: (limit?: number) =>
    invoke<ActivityEvent[]>("list_activity_events", { limit }),

  getExecutionMode: () => invoke<string>("get_execution_mode"),

  setExecutionMode: (mode: string) => invoke<void>("set_execution_mode", { mode }),

  getMissedSchedulePolicy: () => invoke<string>("get_missed_schedule_policy"),

  setMissedSchedulePolicy: (policy: string) => invoke<void>("set_missed_schedule_policy", { policy }),

  computeSchedule: (input: {
    mode: string;
    distribution: string;
    item_count: number;
    exact_times: number[];
    window_start: number;
    window_end: number;
    interval_start: number;
    interval_seconds: number;
    days: {
      day_start: number;
      window_start_offset: number;
      window_end_offset: number;
      item_count: number;
    }[];
    min_gap_seconds: number;
    seed: number | null;
  }) => invoke<{ item_index: number; scheduled_time: number }[]>("compute_schedule", { input }),

  countScheduledItems: (repository_id: number) => invoke<number>("count_scheduled_items", { repository_id }),

  getSchedulerPaused: () => invoke<boolean>("get_scheduler_paused"),

  setSchedulerPaused: (paused: boolean) => invoke<boolean>("set_scheduler_paused", { paused }),

  openAppDataDir: () => invoke<void>("open_app_data_dir"),
};


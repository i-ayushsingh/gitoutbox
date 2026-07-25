/**
 * GitOutbox Demo Data Generator (Node.js Utility).
 *
 * Generates SQL seed script output or directly populates SQLite database for development testing.
 *
 * Usage:
 *   node generate.js [--preset small|medium|large]
 */

const fs = require('fs');
const path = require('path');

const REPOSITORIES = [
  { name: "GitOutbox", path: "C:\\Projects\\GitOutbox", branch: "main", url: "https://github.com/gitoutbox/gitoutbox.git" },
  { name: "YourCtrl", path: "C:\\Projects\\YourCtrl", branch: "main", url: "https://github.com/yourctrl/yourctrl.git" },
  { name: "Inkr", path: "C:\\Projects\\Inkr", branch: "master", url: "https://github.com/inkr-app/inkr.git" },
  { name: "Portfolio", path: "C:\\Projects\\Portfolio", branch: "main", url: "https://github.com/developer/portfolio.git" },
  { name: "Demo Project", path: "C:\\Projects\\DemoProject", branch: "main", url: "https://github.com/dev/demo-project.git" },
  { name: "Personal Website", path: "C:\\Projects\\PersonalSite", branch: "main", url: "https://github.com/developer/personal-site.git" }
];

const COMMITS = [
  ["feat(ui)", "add repository search bar and live path filtering"],
  ["feat(core)", "implement exponential backoff retry policy"],
  ["feat(tray)", "add system tray pause and resume menu items"],
  ["fix(scheduler)", "resolve scheduler race condition on application restart"],
  ["fix(db)", "prevent duplicate commit creation on crash recovery"],
  ["docs(readme)", "update README with CLI setup and SmartScreen bypass guide"],
  ["refactor(queue)", "simplify queue manager state transition logic"],
  ["style(sidebar)", "improve sidebar icon alignment and active indicator pill"],
  ["perf(timeline)", "optimize activity timeline rendering with date virtualization"],
  ["test(staging)", "add unit tests for exact-path staging verification"],
  ["chore(deps)", "upgrade tauri v2 dependencies and vite build scripts"]
];

function generateSql(preset = "medium") {
  const sql = [];
  const now = Math.floor(Date.now() / 1000);

  sql.push("-- GitOutbox Demo Data Seed Script");
  sql.push(`-- Preset: ${preset.toUpperCase()}`);
  sql.push("BEGIN TRANSACTION;\n");

  REPOSITORIES.forEach((repo, idx) => {
    const repoId = idx + 1;
    sql.push(`INSERT OR IGNORE INTO repositories (id, path, name, created_at) VALUES (${repoId}, '${repo.path}', '${repo.name}', ${now - 86400 * 10});`);
    sql.push(`INSERT OR IGNORE INTO queues (id, repository_id, name, target_branch, execution_mode, status, created_at, updated_at) VALUES (${repoId}, ${repoId}, 'Draft', '${repo.branch}', 'commit_only', 'Draft', ${now}, ${now});`);
  });

  sql.push("\nCOMMIT;");
  return sql.join("\n");
}

if (require.main === module) {
  const presetArg = process.argv.includes("--preset") ? process.argv[process.argv.indexOf("--preset") + 1] : "medium";
  const sqlOutput = generateSql(presetArg);
  console.log(sqlOutput);
}

module.exports = { generateSql };

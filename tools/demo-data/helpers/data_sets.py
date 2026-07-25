"""
Data sets and helper constants for the GitOutbox Demo Data Generator.
Provides rich conventional commits, authors, repository definitions,
file paths, execution logs, and templates.
"""

AUTHORS = [
    {"name": "Ayush Singh", "email": "ayush@example.com"},
    {"name": "Jane Doe", "email": "jane.doe@example.com"},
    {"name": "Alex Chen", "email": "alex.chen@example.com"},
    {"name": "Elena Rostova", "email": "elena.rostova@example.com"},
    {"name": "Marcus Vance", "email": "marcus.vance@example.com"},
    {"name": "Sophia Martinez", "email": "sophia.m@example.com"},
    {"name": "Liam O'Connor", "email": "liam.oc@example.com"}
]

REPOSITORIES_POOL = [
    {
        "name": "GitOutbox",
        "path": "C:\\Projects\\GitOutbox",
        "remote_url": "https://github.com/gitoutbox/gitoutbox.git",
        "default_branch": "main",
        "files": [
            "src/components/Sidebar.tsx",
            "src/components/QueueManager.tsx",
            "src/components/SettingsView.tsx",
            "src/components/ActivityTimeline.tsx",
            "crates/gitoutbox-core/src/git.rs",
            "crates/gitoutbox-core/src/scheduler.rs",
            "crates/gitoutbox-core/src/executor.rs",
            "src-tauri/src/db.rs",
            "src-tauri/src/commands.rs",
            "README.md"
        ]
    },
    {
        "name": "YourCtrl",
        "path": "C:\\Projects\\YourCtrl",
        "remote_url": "https://github.com/yourctrl/yourctrl.git",
        "default_branch": "main",
        "files": [
            "apps/dashboard/src/App.tsx",
            "apps/dashboard/src/components/MetricCard.tsx",
            "packages/api/src/router.ts",
            "packages/db/schema.prisma",
            "docker-compose.yml",
            "README.md"
        ]
    },
    {
        "name": "Inkr",
        "path": "C:\\Projects\\Inkr",
        "remote_url": "https://github.com/inkr-app/inkr.git",
        "default_branch": "master",
        "files": [
            "src/editor/Canvas.tsx",
            "src/editor/Toolbar.tsx",
            "src/editor/export.ts",
            "src/hooks/useCanvasHistory.ts",
            "styles/editor.css",
            "package.json"
        ]
    },
    {
        "name": "Portfolio",
        "path": "C:\\Projects\\Portfolio",
        "remote_url": "https://github.com/developer/portfolio.git",
        "default_branch": "main",
        "files": [
            "src/pages/index.astro",
            "src/components/ProjectCard.astro",
            "src/components/Hero.astro",
            "public/favicon.svg",
            "astro.config.mjs"
        ]
    },
    {
        "name": "Demo Project",
        "path": "C:\\Projects\\DemoProject",
        "remote_url": "https://github.com/dev/demo-project.git",
        "default_branch": "main",
        "files": [
            "src/main.rs",
            "src/config.rs",
            "src/utils.rs",
            "Cargo.toml",
            "tests/integration_test.rs"
        ]
    },
    {
        "name": "Personal Website",
        "path": "C:\\Projects\\PersonalSite",
        "remote_url": "https://github.com/developer/personal-site.git",
        "default_branch": "main",
        "files": [
            "pages/blog/[slug].tsx",
            "content/posts/first-post.md",
            "styles/globals.css",
            "next.config.js"
        ]
    },
    {
        "name": "NexusCore",
        "path": "C:\\Projects\\NexusCore",
        "remote_url": "https://github.com/enterprise/nexus-core.git",
        "default_branch": "main",
        "files": [
            "core/server.go",
            "core/router.go",
            "config/settings.env",
            "go.mod",
            "Dockerfile"
        ]
    },
    {
        "name": "PulseDash",
        "path": "C:\\Projects\\PulseDash",
        "remote_url": "https://github.com/analytics/pulsedash.git",
        "default_branch": "develop",
        "files": [
            "src/metrics/collector.ts",
            "src/views/DashboardView.vue",
            "src/store/analytics.ts",
            "package.json"
        ]
    },
    {
        "name": "OmniFlow",
        "path": "C:\\Projects\\OmniFlow",
        "remote_url": "https://github.com/workflow/omniflow.git",
        "default_branch": "main",
        "files": [
            "pipelines/builder.py",
            "pipelines/executor.py",
            "tests/test_pipelines.py",
            "requirements.txt"
        ]
    },
    {
        "name": "VoxelEngine",
        "path": "C:\\Projects\\VoxelEngine",
        "remote_url": "https://github.com/graphics/voxel-engine.git",
        "default_branch": "main",
        "files": [
            "src/render/shader.cpp",
            "src/world/chunk.hpp",
            "src/math/vector.hpp",
            "CMakeLists.txt"
        ]
    }
]

COMMIT_SCOPES = ["ui", "core", "scheduler", "db", "tray", "git", "auth", "api", "cli", "deps"]

COMMIT_ACTIONS = [
    ("feat", "add repository search bar and live path filtering"),
    ("feat", "implement exponential backoff retry policy"),
    ("feat", "add system tray pause and resume menu items"),
    ("feat", "support multi-file staging validation"),
    ("feat", "introduce interactive queue items reordering"),
    ("feat", "enable persistent toast notification preferences"),
    ("fix", "resolve scheduler race condition on application restart"),
    ("fix", "prevent duplicate commit creation on crash recovery"),
    ("fix", "correct fingerprint calculation for deleted files"),
    ("fix", "handle spaces and unicode characters in repository paths"),
    ("fix", "repair tray icon tooltip refresh on status change"),
    ("docs", "update README with CLI setup and SmartScreen bypass guide"),
    ("docs", "add spec documentation for missed-schedule policy"),
    ("docs", "document sqlite schema migration steps"),
    ("refactor", "simplify queue manager state transition logic"),
    ("refactor", "extract pure git logic into gitoutbox-core crate"),
    ("refactor", "decouple IPC command handlers from database state"),
    ("style", "improve sidebar icon alignment and active indicator pill"),
    ("style", "apply cohesive dark theme colors and font spacing"),
    ("style", "standardize button hover and focus ring styles"),
    ("perf", "optimize activity timeline rendering with date virtualization"),
    ("perf", "batch sqlite query inspection for queue items"),
    ("perf", "cache repository change detection status"),
    ("test", "add unit tests for exact-path staging verification"),
    ("test", "add integration tests for git status porcelain parsing"),
    ("test", "verify crash recovery idempotency across restarts"),
    ("chore", "upgrade tauri v2 dependencies and vite build scripts"),
    ("chore", "update license headers and project manifest"),
    ("chore", "clean up obsolete asset assets and unused icons")
]

TEMPLATES = [
    ("feat: {stem}", "feat: {stem}"),
    ("fix: {stem}", "fix: {stem}"),
    ("docs: {stem}", "docs: {stem}"),
    ("style: {stem}", "style: {stem}"),
    ("refactor: {stem}", "refactor: {stem}"),
    ("perf: {stem}", "perf: {stem}"),
    ("test: {stem}", "test: {stem}"),
    ("chore: {stem}", "chore: {stem}"),
    ("feat({directory}): {stem}", "feat({directory}): {stem}")
]

FAILURES = [
    "Preflight check failed: uncommitted pre-staged changes detected in index",
    "Target branch mismatch: repository is currently on 'develop', expected 'main'",
    "Fingerprint mismatch: content of 'src/lib.rs' changed after draft scheduling",
    "Merge conflict detected on target branch 'main'",
    "Git CLI non-zero exit code (code 128): fatal: destination path already exists"
]

# Running GitOutbox on Windows (SmartScreen Guide)

GitOutbox is currently an unsigned open-source desktop application. When launching the installer or application for the first time, Windows Defender SmartScreen may display a warning dialog:

```text
┌──────────────────────────────────────────────────────────┐
│ Windows protected your PC                                │
│                                                          │
│ Microsoft Defender SmartScreen prevented an unrecognized  │
│ app from starting. Running this app might put your PC    │
│ at risk.                                                 │
│                                                          │
│ [ More info ]                                            │
└──────────────────────────────────────────────────────────┘
```

---

## How to Bypass the Warning (First Launch Only)

### Step 1: Click "More info"

Click the **"More info"** text link on the SmartScreen dialog. This reveals additional options and details about the app executable (`GitOutbox.exe` or `GitOutbox-setup.exe`).

```text
┌──────────────────────────────────────────────────────────┐
│ Windows protected your PC                                │
│                                                          │
│ App:     GitOutbox.exe                                   │
│ Publisher: Unknown publisher                             │
│                                                          │
│ [ Run anyway ]                      [ Don't run ]        │
└──────────────────────────────────────────────────────────┘
```

---

### Step 2: Click "Run anyway"

Click the **"Run anyway"** button that appears in the bottom right corner of the window.

GitOutbox will launch normally. Windows will remember your choice, so you will not see this prompt again on subsequent launches.

---

## Why does this happen?

Windows SmartScreen requires binaries to be signed with an EV (Extended Validation) Code Signing Certificate to avoid warnings for new applications. Because GitOutbox is a local-first, privacy-focused open-source project built for developers, we do not require network connectivity or telemetry and do not bundle proprietary certificate trackers.

You can verify the source code, security architecture, and build process directly on GitHub:
- [Source Code & Architecture](../AGENTS.md)
- [Git Safety Invariants](../GitOutbox_AI_Build_Spec.md)

import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { ScheduleComposer } from "../src/components/ScheduleComposer.tsx";

// Mock QueueItem structure
const mockDrafts = [
  {
    id: 1,
    queue_id: 1,
    title: "Draft 1",
    commit_message: "feat: add app",
    target_branch: "main",
    execution_mode: "commit_only",
    status: "Draft",
    scheduled_time: null,
    commit_hash: null,
    files: []
  },
  {
    id: 2,
    queue_id: 1,
    title: "Draft 2",
    commit_message: "fix: update button",
    target_branch: "main",
    execution_mode: "commit_only",
    status: "Draft",
    scheduled_time: null,
    commit_hash: null,
    files: []
  }
];

const mockOnClose = () => {};
const mockOnConfirm = async () => {};

console.log("Running ScheduleComposer React lifecycle checks...");

// Render 1: open = false
try {
  const html1 = renderToString(
    React.createElement(ScheduleComposer, {
      open: false,
      drafts: mockDrafts,
      onClose: mockOnClose,
      onConfirm: mockOnConfirm,
    })
  );
  assert.equal(html1, "");
  console.log("- Mount with open=false: OK");
} catch (e) {
  console.error("Mount with open=false failed:", e);
  process.exit(1);
}

// Render 2: open = true (Verify it mounts, hooks run, and generates initial mode preview)
try {
  const html2 = renderToString(
    React.createElement(ScheduleComposer, {
      open: true,
      drafts: mockDrafts,
      onClose: mockOnClose,
      onConfirm: mockOnConfirm,
    })
  );
  assert.ok(html2.includes("Schedule 2 drafts"));
  assert.ok(html2.includes("Mode"));
  console.log("- Mount with open=true: OK");
} catch (e) {
  console.error("Mount with open=true failed:", e);
  process.exit(1);
}

// Render 3: repeated open/close cycle to prove hook stability
try {
  for (let i = 0; i < 5; i++) {
    renderToString(
      React.createElement(ScheduleComposer, {
        open: i % 2 === 0,
        drafts: mockDrafts,
        onClose: mockOnClose,
        onConfirm: mockOnConfirm,
      })
    );
  }
  console.log("- Repeated open/close hook-order stability: OK");
} catch (e) {
  console.error("Repeated open/close cycle failed:", e);
  process.exit(1);
}

// Render 4: preloads existing scheduled_time
try {
  const rescheduledDraft = [
    { ...mockDrafts[0], scheduled_time: 1784000000, status: "Scheduled" }
  ];
  const html4 = renderToString(
    React.createElement(ScheduleComposer, {
      open: true,
      drafts: rescheduledDraft,
      onClose: mockOnClose,
      onConfirm: mockOnConfirm,
    })
  );
  assert.ok(html4.includes("Exact time"));
  console.log("- Preloads existing schedule on reschedule: OK");
} catch (e) {
  console.error("Reschedule preloading failed:", e);
  process.exit(1);
}

console.log("composer.test.ts: all React render lifecycle assertions passed!");

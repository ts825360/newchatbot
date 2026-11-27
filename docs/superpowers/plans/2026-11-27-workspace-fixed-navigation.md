# Fixed Workspace Navigation Implementation Plan

**Goal:** Keep workspace navigation geometry independent of the right-side panel and provide one header control for expansion and collapse.

**Architecture:** Keep navigation on the workspace grid's shared row. Give it persistent tracks and a reserved overview position. A single panel state controls summary and tool presentation; tab selection and scoped tool state are independent of presentation.

**Tech Stack:** Next.js, React, CSS Grid, Vitest, Chrome and local Docker.

## Work

- [x] Add regressions for the fixed overview slot, expansion controls and schedule/unsaved input preservation.
- [x] Apply the common layout and controls without changing storage, permissions, or business flows.
- [x] Verify button and icon geometry at stable desktop and mobile viewport widths, including pointer resize; run project regressions.
- [x] Record screenshots and update only the local Docker app after isolated verification and backup.

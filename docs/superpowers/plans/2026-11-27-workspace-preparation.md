# Workspace Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the three preparation tools within the existing docked/expanded workspace.

**Architecture:** Keep preparation records as a projection of existing room, account-room and conversation records, not a second checklist. Keep proposal writes on their existing approval path. Location additions evolve the validated location record without changing its key or boundary. Provider queries use an authenticated optional Maps connector; no Maps credentials are currently configured on the running app.

- [x] Test and implement preparation record links, missing/loading/error/permission distinctions, checklist draft prompts and evidence-based risk labels. Verify no writes during navigation.
- [x] Test and implement proposal layout with normal cards in two columns when space permits and wide forms/timetables spanning both. Preserve decision behavior.
- [x] Test legacy location compatibility, scoped metadata, direct list navigation, carousel, grid filters, edit/delete, share and notes with synthetic places.
- [x] Check Google integration setup and policies. Keep provider data separate from editable private data; use fixed endpoints, bounded requests and no provider content persistence beyond permitted identifiers. Verify with mocks when credentials are unavailable.
- [x] Verify scoped aggregates in the existing AI tool through existing consent and approval gates. No private names, notes or files in provider calls. Direct model use of new Google data remains outside this release until the licensing and integration path is confirmed.
- [x] Run focused tests, full offline suite, production build and isolated browser walkthrough before any local Docker replacement. Update traceability with real, simulated and unverified results.

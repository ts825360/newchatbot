# Transport Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep directions, original observations, allocation work and final approval distinct within the shared event workspace.

**Architecture:** Keep the account-and-event `transport` record and its optimistic write checks. Add append-only versions, local directional constraints, and server-verified comparisons above the existing CP-SAT engine. Keep the original survey source separate from organizer edits. No automatic changes to other workspaces, lodging or timetables.

- [ ] Preserve legacy snapshots; test immutable draft/temporary/confirmed history, unchanged after recalculation and rejected if rewritten through the record API.
- [ ] Improve move conditions, separate boarding surfaces, seat maps, workspace layout, compare entry and approved CSV export without revising lodging.
- [ ] Validate new directional survey branching and safe identity/vehicle linkage, with explicit uncertainty and no automatic household-name guessing.
- [ ] Exercise CP-SAT, locks, time/location conflicts, cost unknown and manual authorization. Add only privacy-safe AI facts where the existing data path supports them.
- [ ] Record implemented and incomplete requirements separately, test with synthetic data and verify Chrome before replacing the local image.

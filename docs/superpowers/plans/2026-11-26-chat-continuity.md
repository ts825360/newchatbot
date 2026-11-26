# Chat Continuity Implementation Plan

**Goal:** Improve context and condition continuity without expanding external transmission by default or adding agenda, roster, or allocation tools.

- [x] Establish regression tests for condition patches, contextual actions, event-date refresh, private context, and multi-turn replies.
- [x] Add a domain-neutral action, patch and visit-basis layer; use it in a bounded, same-conversation context window and in the existing nearby-search handler.
- [x] Keep earlier assistant excerpts behind an independent settings opt-in. Only reuse excerpts from server-verified external replies, never internal replies, or another conversation's data.
- [x] Verify persistence, authorization, mock provider requests, UI and Docker. Register the full judgment roadmap separately from the phase 1 changes.

Verification: 831 tests passed and the live-provider test was skipped. Regression tests cover unrequested disclosure of stored dates, request-only searches without an active task, and replies to older tasks. The Docker production build passed. In an isolated Chrome session with a mocked provider, the independent consent default, persisted setting, prior reply context, and local cancellation were verified. No live provider request was made.

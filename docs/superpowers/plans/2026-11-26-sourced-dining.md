# Sourced Dining Implementation Plan

> **For agentic workers:** Use test-driven development and verify the release before deploying.

**Goal:** Return up to three nearby restaurant candidates with a visit-time basis and clickable evidence in the existing chat.

**Architecture:** Resolve only verified public venues from the current room. Normalize meal timing and preferences on the server. Run one dedicated Responses request with a small built-in web-search budget; validate cited URLs against that response and render a read-only list. Keep general chat, internal tools, and action approvals unchanged.

- [x] Test an unqualified 17:00 Korean-time question, an explicit breakfast, external payload minimization, missing ratings, and invalid or unsuccessful searches.
- [x] Implement bounded web search in `lib/server/chat-openai.ts`, restaurant routing and evidence validation in `lib/server/chat-dining.ts` and `lib/chat-dining.ts`.
- [x] Add source links to `components/chat-panel.tsx`, validate saved replies and update the external-search consent notice.
- [x] Run repository tests, TypeScript, and an isolated browser check using synthetic results. Build the local Docker release without making a paid request.

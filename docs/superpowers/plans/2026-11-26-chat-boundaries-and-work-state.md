# Chat Boundaries and Work State Implementation Plan

**Goal:** Harden the AI boundary and keep user intent, visit conditions, and candidate selections separate from event records.

**Architecture:** Keep authenticated SQLite reads and deterministic validation on the server. Give the model bounded interpretation work only when necessary; never expose personal record rows or grant write tools. Reuse source-aware condition patches and keep the selected result separate from search snapshots.

- [x] Reproduce private input/output leaks and cross-account request blocking, then guard each boundary and separate provider capacity from SQLite history contention.
- [x] Reproduce temporal ambiguity and lost candidate references, then separate temporal intent and search snapshots from the display selection.
- [x] Verify reusable condition handling with an independent scheduling example; retain review, consent and scope limits.
- [x] Run the existing suite, new regressions, TypeScript and isolated Docker/browser checks; keep live provider verification separate.

Verification: 856 tests passed, one live-provider test skipped. The Docker production build (including TypeScript) passed. In isolated Chrome, the mocked search cards displayed unverified evidence, candidate selection preserved the original rank, the direct-quote notice appeared, and a synthetic phone number was blocked. No live model or web-search request was sent.

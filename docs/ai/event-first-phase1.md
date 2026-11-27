# Event-first: phase 1

Base: `93a16c3`. This slice covers preparation evidence and the existing attendance/registration survey template. A private survey draft is not a shared record, an approved draft, a published form, or a response collection.

| Existing boundary | Phase 1 behavior |
| --- | --- |
| Chat endpoint and history revisions | The authenticated account/room/conversation and saved user turn bind all reads. One transaction validates the history revision and saves the draft version and assistant reply. A completed message replay writes nothing again. |
| Local routing and model tools | Existing direct commands remain local. A recognized request to display a survey or check its status also works without external consent. Ambiguous or compound requests already routed to AI can select preparation/read/draft tools in the same bounded tool loop; no additional classifier call was introduced. |
| Work versions and Forms approval | The existing immutable draft and exact version are the source of truth for questions, conditions, and artifact ID. The draft's source-message ID and recorded time stay server-side. Status projects the approval ledger for that exact version: review pending, creation outcome unknown, form created but questions unconfirmed, or unpublished draft created. That ledger does not establish the current publication state. No new database or migration. |
| Scope and data minimization | Shared-calendar aggregates and the user's private planning facts remain separate. Survey tools return scoped version, phase, finite status fields, and the allowlisted question outline; no custom draft labels, Forms IDs, account IDs, or previous answer text are forwarded by these tools. Recheck session/permissions, consent, history, and observed evidence before save. |
| Response and UI | Legacy v1 chat/plan replies and stored records remain readable. V2 adds a numbered display list, bounded separately from the four plan rows and four approval proposals. The server attaches the typed survey work card, and no model-supplied artifact ID or display text is executed. The old prompt-only runner still targets the v1 schema. |

## Boundaries and follow-up

- Scope is the existing account/room/conversation and role checks, not a new per-room membership ACL. No cross-conversation or cross-account memory is introduced. Cancelling ends implicit draft selection but does not delete saved work. Quoted versions can be redisplayed but edits based on a superseded version are rejected.
- The fixed template, its protected branches, and single-question edits are unchanged. Free-form surveys and multi-artifact transactional workflows remain out of scope. An existing status-only local route is not forwarded externally to solve a mixed request.
- The existing Forms ledger preserves remote-write deduplication. Its historical counts and the active draft's exact-version status are different measures. No Google publication or remote-state check occurs in chat.
- The current per-process pending lock and transactional optimistic revision protect writes; they do not guarantee one inference call across worker processes. Actual model interpretation, real Forms behavior, release deployment and further adaptive blocks are not verified by the offline tests.

## Verification

- TypeScript passed. Vitest: 1,068 passed, two opt-in live tests skipped. The mocked provider and isolated SQLite exercised the preparation-to-survey flow, scope isolation, consent revocation, quote conflicts, duplicate request handling, and existing approvals.
- Chrome with an isolated synthetic database at 1440x900 and 390x844 preserved the legacy plan, ten-item list, and survey version on reload. The desktop chat composer also submitted a local survey status request without external-AI consent. No OpenAI or Google Forms API calls.

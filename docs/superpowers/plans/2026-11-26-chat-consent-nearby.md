# Chat Consent and Nearby Recommendations Implementation Plan

**Goal:** Capture optional external chat consent during signup or in settings only, and enrich nearby dining and attraction recommendations with sourced visit details.

**Architecture:** Reuse the account-scoped consent record for transactional signup and an authenticated settings update. Keep the chat handler read-only with respect to consent. Extend the existing capped search request and backward-compatible chat cards; unknown facts remain unknown.

- [x] Test signup consent, rejection of in-chat opt-in, and settings changes across account boundaries.
- [x] Test sourced attraction search, hours and closure details, and suppression of route distances or menus without a source.
- [x] Implement signup and settings controls, inline chat handling, and shared nearby cards.
- [x] Verify tests, browser flows and container before versioned local deployment.

# Event Room Lobby Implementation Plan

**Goal:** Step 2: a compact game-lobby-inspired event room grid, with create,
delete, select and enter interactions. Embed the user's three auth captures
directly in README. Do not redesign the step 3 chat workspace or mobile UI.

**Architecture:** Next.js `/rooms` after login. A per-account sessionStorage
catalog stores room metadata and last-entered room; the existing workspace
consumes that catalog. The existing workspace's content remains mock state.
No actual server security, shared membership, realtime sync or room invites.

- [x] Write failing catalog tests for seeding, validation, create, selection,
  deletion, storage failures, per-account separation, and filtering.
- [x] Implement `lib/room-catalog.ts` and optional account identity on profiles.
  Preserve deletion across reload; never reseed a deliberately empty catalog.
- [x] Write failing UI tests and implement `components/room-lobby.tsx` plus a
  native modal dialog for creation/deletion. Use existing colors and Lucide
  category thumbnails, with stable compact card dimensions and clear focus.
- [x] Wire login to `/rooms`; add `/rooms/page.tsx`; load chosen rooms in the
  existing workspace and add a return-to-lobby action. Preserve auth errors.
- [x] Embed exact user auth screenshots, document room permissions/storage and
  remaining limitations, then capture the new lobby and create/delete views.
- [x] Run tests, TypeScript, production build, desktop Playwright checks, and
  a bounded review. Keep the existing local dev server available.

## UI Decisions

Use a neutral desktop workspace, not the reference game's decorative skin.
Show category, event name, date, preparation state and mock participant count.
Show selected-card feedback; provide explicit enter and delete actions.
Creation uses name, category, optional event date/location and memo.
First/second administrators use the existing room-management permissions;
third administrators can select and enter but cannot create/delete rooms.
Document that all account/room checks are client-side demonstrations only.

## Verification

47 tests pass; TypeScript and production build pass. Playwright verified
signup/login to lobby, filters, creation/reload, entry into new rooms, return,
delete cancellation/confirmation, persisted deletion, Escape, third-grade
permissions, logout gating and 1280/1440/1920 desktop layouts. Screenshots saved
in README. Review found session rechecks could reset existing pin/order/unread
preferences; persist these and add a regression test before completion.

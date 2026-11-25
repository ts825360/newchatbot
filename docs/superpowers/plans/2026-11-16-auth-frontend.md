# Invitation Auth Frontend Implementation Plan

**Goal:** Implement only step 1: entry, invitation signup, and account login screens.

**Architecture:** Keep the existing Next.js prototype. Add `/signup`, `/login`,
and `/workspace`; use a browser-tab-only mock auth adapter, not a backend.
The database, secure sessions, real invitations, annual server-side expiry,
room lobby, and redesigned workspace remain outside this change.

## Tasks

- [x] Add failing tests for signup validation, invitation consumption, duplicate
  usernames, login, expiry, session clearing, and account lookup.
- [x] Implement `lib/prototype-auth.ts` with versioned sessionStorage data.
  Never persist plaintext passwords. Any local digest is mock-only, not secure
  authentication. Browser storage failures must produce an actionable error.
- [x] Test and implement entry/signup/login UI in `components/auth-screen.tsx`.
  Use the existing colors, icons, and compact form styling. Include labels,
  field errors, password visibility controls, submission states, and return links.
- [x] Add routes and connect successful login to the existing prototype.
  Replace its old invite-key entry with a mock-session check and real logout flow.
- [x] Add README with exact routes, demo invitation codes, test instructions,
  storage limitations, implementation status, and deferred steps 2 and 3.
- [x] Run all tests, TypeScript, production build, and desktop browser checks.

Verification: 29 tests pass; TypeScript and production build pass. Playwright
checked the complete auth flow, reload, logout, direct-entry redirect, reused
invites, theme persistence, and desktop widths 1280, 1440, and 1920. Screenshots
are in `docs/prototypes/screenshots`. Review identified a logout storage-failure
case; a regression test and recoverable error screen were added.

## Acceptance

The initial screen offers login/signup only, without workspace content.
Signup requires a known unused demo invitation, display name, unique username,
password and matching confirmation. It returns to login, which rejects incorrect
credentials and enters the existing workspace on success. Reloading within the
same tab preserves demo registration; signing out blocks workspace entry.
The README must not claim server authentication or cross-device accounts.

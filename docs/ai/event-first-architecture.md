# Event-first AI architecture — implementation contract

## Priority
P0 event task quality, safety, privacy and existing feature preservation. P1 reusable infrastructure. Church administration and personal assistant are future domains, not current feature requirements. No GPU dependency or new framework. The current active profile remains event specialist; do not silently route to an unimplemented profile.

## Incremental implementation
1. Audit current request routes, consent checks, data access, persistence, output parsers and UI consumers. Record existing contracts and regression cases before changing them.
2. Context: use existing SQLite. Add typed task state only after checking existing chat_work_versions and conversation records. Scope by account/room/conversation; shared approved artifacts by room and ACL. Track source, version, status, conditions, timestamps and next action. Never treat assistant text as confirmed fact. Retrieve relevant state rather than entire history. Preserve consent requirements. No personal memory expansion in this release.
3. Capability registry: each tool declares purpose, supported input/output, scope, required permission, consent, read/draft/commit effect, evidence and failure semantics. Server enforces all checks. Model chooses semantic tasks; deterministic calculations, validation and explicit UI commands remain deterministic. Preserve existing no-consent local paths; never silently send a formerly local request externally. Ambiguous requests with no consent get safe local assistance or a clear limitation. Do not remove regex routes until equivalent safe behavior is verified.
4. Prompt composition: shared core + active event profile + relevant task guidance + permitted context/tools + output contract. Start with full existing event profile as safe fallback. Do not prune mandatory safety, privacy or approval rules. Multi-domain event requests may use several task modules. No separate paid classifier call by default; use existing context and model tool selection. If module selection is uncertain, retain relevant event guidance. Measure quality manually before optimizing prompt length.
5. Adaptive response: separate display blocks (paragraph, list, table, artifact reference) from typed action proposals. Version schema and retain legacy rendering. Validate lengths, block counts, IDs and escaping; never render arbitrary HTML or execute display text. Preserve old conversation records. Complex artifacts belong in versioned work storage, not an oversized summary. Keep bounded output/tool budgets with explicit partial result handling.
6. Knowledge: structured event data first; local extraction/search of shared materials and approved historical records next. No raw internal documents or roster PII sent to external models; enforce allowlisted derived fields and source ACL before retrieval and transmission. External discovery is a separate public-data path; verify official facts, distinguish unverified ideas, retain source URLs. Existing 1–3 candidate limit remains until parser/UI/search budget migration.
7. Model adapter: provider-neutral internal messages, tool calls/results, structured response and usage metadata. Existing OpenAI adapter remains default. Future local provider requires capability, privacy, latency and quality verification; no claim of identical performance.

## First vertical slice (P0)
User asks current event progress or continues a survey. Retrieve authorized current task and event facts, preserve previous conditions, choose supported read/draft tool, validate result, render useful response, persist versioned state. Include cross-task dependencies without creating unrelated proposals. No automatic publishing. Implement this end-to-end before broad memory/RAG or new personal domains.

## Acceptance (offline technical checks, user manual quality)
- Existing tests and type checks pass; existing event UI, stored chats and approvals preserved.
- Synthetic cross-account/room denial, revoked consent, stale versions, prompt injection, tool failure, duplicate execution and unauthorized mutation tests.
- Same request with/without external consent: no silent external transfer.
- Follow-up retains unchanged conditions and exact artifact reference; unrelated request does not inherit them.
- Survey purpose and supported tool limitations explicit; no fake completion.
- Ten-item response renders ten distinct items without parser failure; long artifact is not falsely labeled complete.
- Manual user evaluates actual AI replies; Codex reports actual context/tool/parser evidence; ChatGPT improves generalized prompts. No automatic paid API runs without approval.

## Current state
This document is a design contract, not implemented infrastructure. Current branch only changes shared/event prompt text and existing output guidance. No new memory, routing, tool registry, RAG, UI, provider or DB schema is implemented here. Existing master-prompt branch and main are preserved. Coordinate with local Codex before integration.

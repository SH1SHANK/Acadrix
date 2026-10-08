# Architecture Decision Records (ADRs)

This directory documents the significant architectural decisions, trade-offs, and design rationale for the Acadrix platform.

## ADR Lifecycle
```text
PROPOSED ──► ACCEPTED ──► (SUPERSEDED by ADR-xxx | DEPRECATED)
```
- **Historical Immutability**: Accepted ADRs are never deleted or rewritten to change past facts.
- **Superseding**: When an architectural decision evolves or is replaced, a new ADR is authored explicitly referencing and superseding the previous one.

---

## Index of Decisions

| ADR | Title | Status | Date | Area |
|---|---|---|---|---|
| **[ADR-001](ADR-001-execution-world-boundary-and-read-bridge.md)** | Execution-World Boundary and Read-Only CustomEvent Bridge | Accepted | 2026-10-08 | Security / Execution Worlds |
| **[ADR-002](ADR-002-privileged-write-and-scaffold-verification.md)** | Privileged Write Mechanism via Background Scripting and Byte-for-Byte Scaffold Verification | Accepted | 2026-10-08 | Security / Code Writes |
| **[ADR-003](ADR-003-embedded-code-editor-over-import-modal.md)** | Retirement of "Import Code" Modal in Favor of Embedded Extension-Owned Code Editor | Accepted | 2026-10-08 | UI / AI Assistance Workflow |
| **[ADR-004](ADR-004-canonical-indexed-answer-protocol.md)** | Canonical Indexed Answer Protocol over Raw JSON and Semicolon Streams | Accepted | 2026-10-08 | Bridge / Interchange Protocols |
| **[ADR-005](ADR-005-authoritative-academic-events-over-dom-scraping.md)** | Authoritative Backend Academic Event Store over DOM Deadline Scraping | Accepted | 2026-10-08 | Notifications / Data Architecture |

# ADR-005: Authoritative Backend Academic Event Store over DOM Deadline Scraping

## Status
Accepted

## Date
2026-10-08

## Context
Acadrix provides deadline tracking, countdown badges in the course navigation sidebar, and background desktop notifications via Chrome alarms.

Browser extensions typically scrape deadline text directly from the host page DOM (e.g. querying `.deadline-text`, regex-matching `"Due on 15 Oct, 23:59"`, or inspecting table cells). However, on the IITM Online Degree portal, DOM deadline scraping is fatally flawed:
1. **Formatting Inconsistency**: Instructors format dates haphazardly across courses (`15/10/2026`, `Oct 15, 11:59 PM`, `Sunday midnight`, `15-Oct-26`).
2. **Timezone Ambiguity**: Host DOM strings often omit timezone offsets, leading to incorrect calculations when students travel or run system clocks outside India Standard Time (IST).
3. **Dynamic Angular Virtualization**: Portal sidebars and course trees are rendered lazily; unexpanded course units do not exist in the DOM.
4. **False Inferences**: A student viewing an assignment cannot be reliably inferred to have submitted it based on CSS classes alone.

## Decision
1. **Zero Portal Scraping for Deadlines & Events**: Prohibit scraping academic deadlines, exam dates, or project milestones from the IITM portal DOM.
2. **Canonical Backend Source of Truth**: Sourced authoritatively from Supabase `public.academic_events` via `AcademicEventRepository`.
3. **Strict Timezone Boundary**: All deadline evaluations, calendar arithmetic, and day differences must execute strictly within the `Asia/Kolkata` timezone boundary (`Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata" })`).
4. **Standardized Urgency Windows**:
   - 72 Hours (3 Days prior)
   - 24 Hours (1 Day prior)
   - Due Today (Calendar day match in Kolkata)
   - 6 Hours (Final warning)
   - Overdue
5. **Idempotent Background Alarm Scheduling**:
   - Reconcile Chrome alarms (`chrome.alarms`) on startup, installation, and cloud sync.
   - Name alarms with deterministic keys (`acx:deadline:<eventId>:<window>`).
   - Deduplicate sent alerts via `sentNotificationsMap` and prune records older than 60 days.
6. **Conservative Submission Status Invariant**: If backend evidence is missing, submission status is marked `UNKNOWN` rather than guessing. Overdue notifications are suppressed when submission status is `UNKNOWN` to avoid false alarms.

## Alternatives Considered

### Alternative 1: Hybrid DOM Scraping with Fallback to Backend
- *Pros*: Provides deadline indicators even if the student is offline and has no cached Supabase data.
- *Cons*: Introduces competing sources of truth; a stale DOM string could override a newly extended backend deadline.
- *Reason for Rejection*: Violates the single-source-of-truth principle.

### Alternative 2: Local Browser-Only Manual Deadlines
- *Pros*: Zero backend dependency.
- *Cons*: Requires students to manually enter every deadline across all enrolled courses; fails to update when instructors extend deadlines.
- *Reason for Rejection*: High friction, error-prone, and poor user experience.

## Consequences
- **Positive**: 100% reliable deadline calculations with zero layout fragility.
- **Positive**: Correct handling of month boundaries, leap years, and daylight transitions relative to IST.
- **Positive**: Idempotent alarms eliminate duplicate notifications.
- **Negative**: Requires initial network synchronization to seed the local indexed cache (`acx:deadlines:v1`).
- **Negative**: If an event is missing from the Supabase repository, no deadline indicator is displayed.

# ADR-029 — Arrears Reminder Delivery & Scheduling (M16.8)

**Status:** Accepted
**Date:** 22 October 2026

## Context

M16.6 (`ADR-027`) gave WaslProp live arrears/aging, collection cases, and
a `PaymentReminder` model whose only lifecycle was `DRAFT -> SENT|FAILED|
CANCELLED` set manually — nothing ever actually sent, and nothing was
scheduled. M16.8 closes that gap: automatically identify eligible
overdue accounts, prepare reminders for a manager's review, support
explicitly approved email delivery, record delivery outcomes, and
prevent duplicate, premature, incorrect, or unauthorised communications.

The brief is explicit that this must **extend** M16.6's existing
`PaymentReminder`/`CollectionCase` models and the application's existing
email infrastructure (`src/lib/email.ts`) — never a second, parallel
collections or notification system — and that automatic dispatch without
manager approval, SMS/WhatsApp/postal delivery, interest/penalty
calculation, and statutory NSW debt notices are all explicitly out of
scope for this MVP.

## Decisions

### D1 — Two independent, default-off switches, not one

`ReminderPolicy.enabled` gates whether the daily eligibility evaluator
runs for a property at all; `ReminderPolicy.deliveryEnabled` separately
gates whether an `APPROVED` reminder may actually be dispatched. Both
default `false`, and both are evaluated on top of — never instead of —
the process-wide `EMAIL_SEND_DISABLED` kill switch. This lets a manager
turn on "show me who's eligible" without simultaneously authorising any
email to leave the building, which the brief calls out explicitly
("explicit delivery controls... separate from env config").

### D2 — Reusing `CollectionCaseStatus`, not a new `PaymentArrangement` model

The brief requires suppressing reminders when a case is "disputed,
paused... or has an active payment arrangement," but the M16.6 schema had
no `DISPUTED`/`PAUSED` status and no `PaymentArrangement` model at all.
Rather than build a new model purely to represent "an arrangement is in
place" (which M16.8's scope explicitly excludes — no recovery-cost or
legal-escalation machinery), two new enum values were added
(`DISPUTED`, `PAUSED`), and the existing `AWAITING_PAYMENT` status is
explicitly reinterpreted to also stand in for "an active payment
arrangement exists." This is a deliberate, documented stretch of an
existing value rather than new schema surface — revisit if a dedicated
payment-plan feature is ever built.

### D3 — Eligibility never requires (or creates) a `CollectionCase`

The brief asks explicitly: "do not assume a collection case must already
exist for eligibility... document whether queue creation also creates
cases." Decision: it does not. `ReminderEligibilityService.evaluate`
links a new candidate to an existing non-terminal case if one exists (so
the Collection Timeline shows it alongside other activity), but a lot
with no case yet is still fully eligible — the candidate is created with
`collectionCaseId: null`. Opening a case remains a deliberate human
action via the existing M16.6 `createCollectionCase` endpoint; M16.8
never calls it automatically.

### D4 — Recipient resolution is one function, called three times, never cached

`resolveRecipient()` (`reminder-recipient.ts`) is the single place "who do
we email" is answered, against `PropertyMembership` (`role=OWNER`,
`status=ACTIVE`, effective-dated via `startDate`/`endDate`) joined to
`PropertyContact` (`status=ACTIVE`, a syntactically valid email) — never
a lot label, a username, or an unrelated staff user. It is called fresh
at candidate-creation, at approval, and again immediately before
dispatch; a lot with zero active owners or an inactive/invalid contact
resolves to `NO_OWNER`/`INVALID_CONTACT` and is **never** sent to a
substituted address. Two or more simultaneous active owners is not
treated as ambiguous — joint ownership is a real, unambiguous
relationship — every active co-owner is returned and addressed.

One correctness note surfaced while testing this against a same-day
membership: `startDate`/`endDate` are full `DateTime` columns, while the
"as of" comparison is always a calendar date at UTC midnight. Comparing
`startDate: { lte: asOf }` would wrongly exclude a membership created
later in the same UTC day it started (its timestamp is after midnight,
`asOf`'s). The query instead compares `startDate: { lt: startOfNextDay }`
— "started on or before this calendar date," regardless of time-of-day.

### D5 — Approval is revalidated twice, independently, never trusted once

`ReminderApprovalService.approve()` and `ReminderDispatchService.
dispatchOne()` **each** independently recompute live overdue charges
(via `ArrearsService.getLotDetail`/`getOverdueLotsForReminders` — the
same M16.6 calculation, never a second one) and the current recipient,
and refuse to proceed on any mismatch: a settled/reduced debt cancels the
reminder outright; a changed amount or recipient refreshes the stored
snapshot and requires a fresh, explicit re-approval; an unresolved
recipient blocks approval entirely. This is two independent checks, not
one trusted twice, satisfying the brief's "before approval and again
immediately before dispatch, recalculate."

A subtlety found while writing integration tests: these early-exit paths
(cancel-on-settled, refresh-on-stale) must **persist** their write even
though the call ultimately reports failure to the caller. Wrapping the
whole `approve()` body in one `$transaction` and throwing from inside it
rolls the entire transaction back — including the CANCELLED write that
was supposed to survive. `approve()` therefore performs those
early-exit writes directly against `this.prisma` (committing
immediately), and only wraps the final, all-or-nothing approval write in
its own transaction.

Approval stores an **immutable snapshot** (`approvalSnapshot`: approver,
timestamp, recipient, amount, charge refs, template/policy version) —
display of what was approved never drifts even if the underlying
reminder record changes shape later.

### D6 — Explicit `QUARANTINED` status for the unavoidable ambiguous case

A provider call can time out after the provider has already accepted the
message — the worker genuinely does not know whether it sent. Blindly
retrying risks a duplicate email; blindly marking it `FAILED` risks a
silently lost reminder if it actually went out. Rather than follow the
existing `Communication` module's precedent of auto-reclaiming a
stuck-`SENDING` row after a timeout, M16.8 introduces a dedicated
`QUARANTINED` status (`EmailProviderError.code === 'TIMEOUT'`) that is
**never** automatically retried or auto-resolved — only
`resolveQuarantine()`, an explicit human decision with an audited note,
moves it to `SENT` (confirmed, matches provider records) or back to
`APPROVED` (confirmed not sent, safe to re-dispatch).

### D7 — `EMAIL_SEND_DISABLED` is checked explicitly, before every send

`src/lib/email.ts`'s `EmailService.send()` already silently suppresses
sending when disabled, returning `{}` without throwing — convenient for
most callers, but insufficient here: the brief requires the dispatch
worker to **never falsely report `SENT`**. `ReminderDispatchService.
dispatchOne()` therefore calls `isEmailSendSuppressed()` itself, before
ever calling `emailService.send()` or creating a
`PaymentReminderDeliveryAttempt` row, and reverts cleanly to `APPROVED`
with a dedicated activity event when suppressed — so a suppressed run
can never be confused with a genuine send at the reminder's own status
level.

### D8 — Atomic claim-then-send, service-level dedup for the (lot, stage) pair

Dispatch uses the same compare-and-swap pattern as
`CommunicationDeliveryService.processDue`: `updateMany({ where: {
status: 'APPROVED' }, data: { status: 'QUEUED' } })`, checking the
affected-row count, so two concurrent dispatch attempts (a scheduler tick
racing a manual click, or a doubled API retry) can only ever claim and
send once. Eligibility evaluation similarly dedups by checking for an
existing non-terminal/suppressed candidate for the same `(spaceId,
reminderStage)` pair before creating a new one — a service-level check
rather than a DB-level partial unique index (the same convention already
used elsewhere in this schema for `PostingProfileRule`/`FinancialFund`
uniqueness), given Prisma's limited support for complex partial
constraints and the time available for this milestone.

### D9 — Scheduling produces candidates, never emails; no catch-up dispatch

`InProcessReminderEligibilityScheduler`/`InProcessReminderDispatchScheduler`
follow the existing in-process `setInterval` + `.unref()` convention
(`InProcessComplianceScheduler`/`InProcessDeliveryScheduler`) rather than
introducing a new durable-job mechanism for this MVP. Each tick only acts
on what is currently true (lots overdue today, reminders currently
`APPROVED`) — there is deliberately no "catch up everything missed while
the server was down" pass, since that is exactly the mechanism that could
turn a downtime incident into a burst of duplicate or badly-timed
communications.

## Consequences

- A manager can see exactly who is eligible for a reminder, and why,
  before anything is ever sent — the review queue is real data, not a
  preview of a decision already made.
- No email leaves WaslProp for a reminder unless three independent gates
  all say yes: `ReminderPolicy.enabled` (evaluation ran),
  `ReminderPolicy.deliveryEnabled` (this property allows real delivery),
  and `EMAIL_SEND_DISABLED` is unset — and even then, only for a reminder
  a human explicitly approved, revalidated a second time immediately
  before the provider call.
- `QUARANTINED` reminders require a human to look at them; there is
  currently no automated reconciliation against the provider's own
  delivery log beyond the signed webhook — an operational gap worth
  monitoring once real provider traffic exists.
- Statutory/legal NSW debt-notice content, recovery costs, and payment
  arrangements remain explicitly out of scope — `AWAITING_PAYMENT` is a
  documented stand-in, not a real payment-plan feature.

## Addendum (22 October 2026) — frontend, contract extensions, and scheduler safety review

### D10 — The review screen must show the real email, not an approximation

The approval screen's brief requires showing "the email subject and
rendered body before approval" — but `ReminderApprovalService.getDetail`
originally returned only the stored `content` snapshot, never the
rendered email itself. Extended `getDetail` to call the exact same
`renderReminderEmail()` the dispatch worker calls, using the same live
recipient/charge data already being recomputed for the staleness check —
so the preview is never a second, independently-formatted copy that
could drift from what actually gets sent. Returns `emailPreview: null`
with an explanatory `emailPreviewUnavailableReason` when no recipient is
resolved, rather than rendering a preview with a fabricated "to" address.

### D11 — The EMAIL_SEND_DISABLED banner needs a boolean, not the secret

The Policy Settings screen must show the kill switch as "a hard global
restriction without exposing secrets." `ReminderPolicyService`'s view now
includes `emailSendGloballyDisabled: isEmailSendSuppressed()` — the same
boolean the dispatch worker itself checks, never the underlying
`EMAIL_SEND_DISABLED` env value or any other configuration detail.

### D12 — Audit evidence needs approver/version fields exposed, not just timestamps

The Delivery History screen's "Audit Evidence" card needs
`approvedByUserId`, `templateVersion`, and `policyVersion` — fields that
existed on `PaymentReminder` since the original migration but were never
included in `toQueueView`'s projection. Added them (plus
`providerMessageId`, already used internally but not returned) rather
than inventing a parallel "audit" endpoint. This mirrors the existing
`BankReconciliation` convention of exposing raw user ids rather than
resolving display names — no user-directory lookup exists in this
service, and inventing one was out of scope.

### D13 — Two real defects, found by writing the UI against the real contract

Building the frontend against the actual API (rather than an assumed
shape) is what surfaced both D4's and D5's fixes in the base ADR above —
the "no recipient on a same-day membership" and "cancelled-but-rolled-
back" bugs were found while writing this milestone's own integration
tests, not the frontend work itself, but are recorded here because the
UI is what would have silently shown the resulting stale/missing state
to a manager if they'd gone unfixed.

### Scheduler safety review

A focused, non-refactoring review of `reminder-scheduler.ts` against six
specific questions, backed by three new concurrency-focused integration
tests (`test/integration/financial-reminder-delivery.test.ts`, "scheduler
safety" block):

1. **Single-instance deployment assumption.** `InProcessReminderEligibilityScheduler`/
   `InProcessReminderDispatchScheduler` are in-process `setInterval` timers
   (no cross-instance coordination) — the same assumption as the existing
   `InProcessComplianceScheduler`/`InProcessDeliveryScheduler`. This is
   correct for WaslProp's current single-instance deployment topology
   (CLAUDE.md: "a single edge/load balancer in front of the app"). It is
   **not** safe to run two app instances with both schedulers active
   without further work — see point 2 for what specifically would and
   would not break.
2. **Duplicate job execution cannot duplicate a send.** Verified directly:
   two truly concurrent `dispatchNow()` calls (`Promise.allSettled`, not
   sequential) against the same `APPROVED` reminder result in exactly one
   `emailService.send()` call and one `fulfilled`/one `rejected` outcome.
   This holds **at the database level** (`updateMany` compare-and-swap on
   `status = 'APPROVED'`), not in-process memory — so it is safe even
   across multiple app instances sharing one Postgres database. The one
   dimension that is **not** instance-safe: `ReminderEligibilityService.evaluate`'s
   (lot, stage) dedup is a plain check-then-create with no DB-level unique
   constraint (ADR-029 D8 already documents this as a conscious,
   service-level choice) — two overlapping evaluation runs (e.g. two app
   instances' schedulers firing at once) could theoretically create two
   `READY_FOR_REVIEW` candidates for the same lot/stage. This was verified
   NOT to risk a duplicate send: both candidates would still require
   independent manager approval, and approval re-validates live state, so
   the worst case is a manager seeing a duplicate reviewable row, never a
   duplicate email. Documented as a known limitation rather than fixed
   with a DB migration, per the instruction not to introduce new
   infrastructure without a concrete correctness issue — a duplicate
   *candidate* is not a duplicate *send*.
3. **Restart behaviour / missed eligibility runs.** Both schedulers start
   fresh on process restart with no persisted "last run" cursor beyond
   `ReminderPolicy.lastEvaluatedAt` (informational only, not used to
   catch up). A missed eligibility window is simply caught on the next
   tick using the then-current overdue state — never backfilled for the
   missed day, which is the explicit, desired behaviour (no fabricated
   "reminder should have gone out 3 days ago" candidates).
4. **EMAIL_SEND_DISABLED prevents every provider call.** Verified both by
   the existing unit-level suppression tests and, this pass, live against
   the actual running dev server: `GET .../reminders/policy` returns
   `emailSendGloballyDisabled: true` reflecting the real
   `EMAIL_SEND_DISABLED=true` in `.env`, and `dispatchOne()`'s explicit
   `isEmailSendSuppressed()` check (D7) runs before any attempt row is
   even created.
5. **Ambiguous provider outcomes remain quarantined.** Re-confirmed: a
   `TIMEOUT` sets `QUARANTINED` and a second `dispatchNow()` call on the
   same reminder is rejected (wrong status), never silently retried.
6. **No catch-up mass dispatch after downtime.** `processDue()` only ever
   selects currently-`APPROVED` reminders for properties with
   `deliveryEnabled: true` at query time — there is no "queue of things
   that should have been sent while the process was down" to drain.

### Frontend (completed this pass)

All four required screens — Reminder Queue, Reminder Policy Settings,
Reminder Review & Approval, Delivery History & Detail — are implemented
against the real API above, integrated into the Arrears Dashboard and
Lot Detail navigation. See the traceability matrix's "M16.8 frontend"
entry for the full file list, test coverage, and the explicit limitation
that no browser-automation tool was available in this environment (live
validation was instead performed via direct HTTP calls against the
running dev server, and via Vite's dev-transform endpoint confirming
every new module loads without error).

## Addendum 2 (22 October 2026) — unifying the M16.6 manual draft and M16.8 automated pipelines

### The defect

M16.6's `draftReminder` (still live, under `/lots/{spaceId}/reminders`)
creates a `PaymentReminder` in `DRAFT` — a status the M16.8 approval/
dispatch pipeline never accepts. `ReminderApprovalService.approve` only
operates on `READY_FOR_REVIEW`. A manager who manually drafts a reminder
therefore has no way to approve or dispatch it — the only action
available was `cancel`. Two reminder "systems" existed side by side,
sharing one table but with no path between them.

### D14 — One explicit transition, not a merged creation path

Rather than changing `draftReminder` itself (which stays exactly as it
was — a point-in-time preview snapshot, never sending anything, per
ADR-027) or inventing a second approval pipeline for manual reminders, a
single new method, `ReminderApprovalService.submitForReview`, is the
one explicit, human-authorized `DRAFT -> READY_FOR_REVIEW` (or
`SUPPRESSED`, or `CANCELLED`) transition. It operates on the existing
row in place — no new `PaymentReminder` is ever created, and no
financial/audit history is deleted — so a reminder's `publicReference`,
`generatedByUserId`, and `generatedAt` continue to describe exactly how
and when it first came into existence, regardless of which pipeline it
later joins.

### D15 — Shared restriction logic, not a second copy of it

`submitForReview` calls the exact same functions
`ReminderEligibilityService.evaluate` uses — `computeSuppressionReason`
and `hasActiveReminderForStage`, both extracted from the evaluator and
exported for this purpose — rather than re-implementing the minimum-
threshold, case-status-suppression, per-case/rolling-window-cap, and
duplicate-stage-dedup rules a second time. `evaluate` itself was
refactored to call these same extracted functions, so there is now
exactly one implementation of each rule, exercised by both entry
points. A manual submission can never bypass a restriction an automated
candidate would have been stopped by.

### D16 — Two rules a manual submission deliberately does NOT inherit

`ReminderPolicy.enabled` and the `initialDelayDays`/
`followUpIntervalDays` timing rule are the two eligibility checks
`submitForReview` does not apply, for a specific reason each:

- **`enabled`** gates the *automatic, unattended, daily* evaluation
  sweep. A manager manually drafting and submitting a reminder right
  now is not that sweep — it is itself the human judgment the sweep
  exists to substitute for when nobody is looking. Requiring `enabled`
  to be true first would mean the manual path only works when the
  automatic path is also configured, which has no safety justification
  and would make the "two entry points" requirement meaningless.
- **The timing rule** (initial delay / follow-up interval) exists to
  pace reminders a machine is generating on a clock, so a scheme isn't
  pestering an owner the day after a levy is issued. It has no meaning
  against a human who has looked at the lot's current position and
  decided, right now, to send a reminder — second-guessing that
  decision against a clock the manager isn't using would be a UX
  regression dressed up as a safety measure.

Every OTHER restriction (minimum-outstanding threshold, case-status
suppression, caps, dedup) still applies in full — see D15. This
distinction is documented here precisely so it is never "fixed" into
uniformity by someone who hasn't read why it's deliberate.

### D17 — Settled-debt and suppression outcomes are visible, not silent errors

Consistent with `approve()`'s own established behavior (ADR-029 base
decisions): a draft whose debt has since been fully settled is
`CANCELLED` (not left as a dangling `DRAFT`), and a draft for a lot
whose collection case is on hold is moved to `SUPPRESSED` with the
reason recorded — never a bare 409 with no state change and no
explanation. Both writes happen via `this.prisma` directly before the
method throws, for the same reason `approve()`'s settled-debt branch
does: a throw inside the interactive transaction that follows would
otherwise roll back the very state change the error message describes.

### D18 — Serializable isolation for the one place two rows could race

The eligibility evaluator's own (lot, stage) dedup (ADR-029 D8) is a
plain check-then-create with no DB-level lock — an accepted, documented
limitation because the race there is between a scheduler sweep and
itself, and any resulting duplicate is caught at approval time. The
race `submitForReview` must additionally guard against is different in
kind: a manual draft and an automated candidate for the SAME lot/stage,
submitted and approved independently, each believing it is the only
active reminder. `submitForReview` therefore runs its duplicate-check
and status-transition inside one `Prisma.TransactionIsolationLevel.
Serializable` transaction — not a new piece of infrastructure, just a
stronger isolation level on an existing transaction — so Postgres
itself aborts one side of a genuine conflict (surfaced as a 409 asking
the caller to retry) rather than ever letting two active reminders exist
for the same debt episode. Verified with a true `Promise.allSettled`
concurrency test against the same draft row, and with a sequential test
proving an automated candidate created after a manual draft (which the
evaluator's own dedup does not see, since it only checks the active-
pipeline statuses, never `DRAFT`) correctly blocks that draft's later
submission rather than allowing two active reminders to coexist.

### New audit events

`REMINDER_SUBMITTED_FOR_REVIEW` and `REMINDER_SUBMISSION_SUPPRESSED`
distinguish a manually-submitted outcome from the automated evaluator's
`REMINDER_CANDIDATE_CREATED`/`REMINDER_CANDIDATE_SUPPRESSED` in the
activity timeline — the two entry points converge on the same pipeline,
but the audit trail still shows which one a given reminder came from.

### Frontend

"Submit for Review" was added to both required surfaces: the M16.6
`ReminderPreviewModal` (reached from Lot Detail) gets a new button
alongside the existing "Cancel Reminder", calling the M16.8 endpoint
directly via the existing M16.8 hooks (no new submission logic in the
frontend either); the M16.8 `ReminderReviewPage` — which already worked
for any reminder id regardless of status — gets the same button for a
`DRAFT` reminder, replacing the (inapplicable) stale-approval banner
with a plain explanatory note. A pre-existing related gap was fixed in
the same pass: both `handleApprove` and the new `handleSubmitForReview`
now refetch the detail on a 409, since a settled-debt rejection still
changes the reminder's status server-side (to `CANCELLED`) and the page
was previously left showing the stale pre-rejection status.

### Tests

12 new backend integration tests (40 total in the M16.8 suite) covering
every requirement above: full convergence through approve+dispatch,
independence from `ReminderPolicy.enabled`, exemption from the timing
rule, settled-debt cancellation, threshold enforcement, case-status
suppression, missing-recipient handling, cross-entry-point duplicate
blocking, status-guard rejection, true concurrency, authorization, and
history preservation (no new row created). 6 new frontend tests across
the two affected components.

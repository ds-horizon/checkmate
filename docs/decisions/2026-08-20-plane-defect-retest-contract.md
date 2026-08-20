# Checkmate to Plane defect and retest contract

Status: Approved Phase 0 decision record for BIZ-36 and BIZ-37

Date: 2026-08-20

Implementation status: foundation in progress and disabled; no Checkmate result creates or updates a Plane resource

## Purpose

This document defines the product and reliability boundary for turning an actionable human Checkmate result into a correlated Plane defect and returning a developer readiness signal to the exact Checkmate test step.

It is deliberately a contract, not an implementation design. BIZ-39 must not encode a routing, retention, ownership, readiness, or provider behavior that remains unresolved below.

## Evidence vocabulary

- **Verified source**: confirmed in the named repository and commit.
- **Verified live read**: confirmed through a read-only request to the current Plane development instance.
- **Approved decision**: explicitly approved for this project and recorded on BIZ-36.
- **Unverified**: plausible or documented by a provider, but not proven against the deployed environment and intended service identity.

## Approved product policy

| Area                                    | Approved behavior                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter                                 | Use a typed Checkmate server adapter that talks directly to Plane. Revisit Robofloyd only if it later satisfies the full correlation and retry contract.                                                                          |
| Creation affordance                     | For an eligible single-result save, show a default-on `Create Plane ticket` control.                                                                                                                                              |
| Eligible results                        | Human `Failed` and human-selected `Retest`. `Blocked` is eligible only when classified as `Product defect`, and defaults on only for that classification.                                                                         |
| Ineligible results                      | `Untested`, `InProgress`, `Skipped`, and `Archived` do not create Plane resources.                                                                                                                                                |
| Bulk behavior                           | Bulk result updates never create Plane resources in the MVP. The UI must disclose this before saving.                                                                                                                             |
| Evidence gate                           | Require useful defect context and disclose the named destination plus the comment and screenshot evidence that will be copied. The Checkmate result save does not depend on Plane availability.                                   |
| Passed before correlation               | If no provider create may have succeeded, end the cycle as `resolved_before_sync`. If a provider create may have succeeded, reconcile authoritatively before canceling or retrying.                                               |
| Readiness                               | Plane readiness updates the defect cycle and retest queue. It never rewrites the last human Checkmate result.                                                                                                                     |
| Failed retest                           | Default to `Same issue`. Same-issue evidence advances the existing cycle. `Different issue` requires an audited supersede or close decision before a new cycle starts.                                                            |
| Tester and developer questions          | Mirror developer questions into Checkmate unless universal tester access to the selected Plane project is proven.                                                                                                                 |
| Link state                              | Show truthful creating, retrying, error, and needs-help states. Show a Plane key only after correlation succeeds.                                                                                                                 |
| Feature flags                           | Creation, evidence copying, inbound sync, notification, and global enablement remain off throughout Phase 0.                                                                                                                      |
| Destination and states                  | Route defects to the development BIZ project. New defects start in Backlog, Done means ready for retest, and a failed same-issue retest reopens the existing item to Todo. Exact provider UUIDs remain environment configuration. |
| Runtime topology                        | Start with a durable leased poller plus periodic reconciliation. Webhooks may replace or supplement it only after signed delivery is proven.                                                                                      |
| Runtime ownership                       | Aza Kai is the initial triage and manual-attention operator. This is an explicit operational assignment, not an inference from implementation ownership.                                                                          |
| Evidence audience and retention         | Plane evidence is private to BIZ project members. Checkmate remains the source of record, and no automatic evidence deletion is enabled initially.                                                                                |
| Provider identity and verification data | Use a dedicated least-privilege Plane service identity and disposable development data for provider contract checks.                                                                                                              |

Aza Kai is the authorized Phase 0 product and routing decision owner and the explicitly approved initial runtime triage and manual-attention operator.

## Provider decision

### Decision: direct Checkmate to Plane adapter

The direct adapter is the selected Phase 2 provider boundary.

Robofloyd is not selected because its current contract does not return or persist the Plane Intake and work-item identifiers needed by Checkmate:

- `POST /hooks/bug-report/submit` accepts a bearer-authenticated payload and returns `{ status, report_id }` after a Redis `XADD`.
- `report_id` becomes the queue `job_id`. Cross-entry queue deduplication is held in Redis for 86,400 seconds.
- The worker invokes an agent that calls `planex intake create`. Success is inferred from the agent process exit code, not from a typed Plane response returned to Checkmate.
- A failed or timed-out worker delivery is retried using the same stream entry. If Plane creation succeeded before the agent timed out, the retry can call `intake create` again.
- The integration has no typed callback or status endpoint that returns the Intake ID, backing work-item ID, attachment IDs, or durable reverse-link ID.

Queue deduplication therefore prevents some duplicate job executions but does not prove exactly-once Plane creation or authoritative correlation. The direct adapter is smaller than extending an agent-driven relay with the missing result and reconciliation protocol.

This conclusion is **verified source** at Robofloyd commit `ef42a6bfe0d17e0a3b038e7ca99e22ede60d21d6`, principally:

- `apps/backend/src/hooks/hooks.controller.ts`
- `apps/backend/src/hooks/envelopes.ts`
- `apps/backend/src/infra/redis/redis.service.ts`
- `apps/worker/src/worker/worker.py`
- `apps/worker/src/worker/redis_stream.py`
- `apps/worker/src/worker/dispatch.py`
- `agents/bug-report/skills/rf-file-bug-report/SKILL.md`

Robofloyd remains a useful precedent for server-side submission, bearer authentication, deterministic local IDs, bounded retry, and project routing. It is not the runtime dependency for this Checkmate integration.

## Plane contract ledger

The current development Plane instance is Community Edition at `https://plane-dev.geep-fence.ts.net`. Its exact Plane version is not reported. `planex doctor` verified authentication, workspace access, projects, members, work items, states, labels, and Intake reads. The BIZ project has Intake enabled. These are **verified live reads**, not create/update runtime proof for the future service identity.

| Contract                      | Evidence                                                                                                                                                                                                                                                                                                                                            | Phase 0 status                      | Required proof before enablement                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API authentication            | Official API documents server-side `X-API-Key`; current `planex` identity can read and write BIZ. A dedicated identity is approved but not yet created or verified.                                                                                                                                                                                 | Partially verified                  | Create the dedicated least-privilege service identity and prove its exact project permissions. Never expose the key to the browser.                                                        |
| Intake and work-item creation | Official API documents Intake creation and work-item creation; `planex` exposes Intake commands.                                                                                                                                                                                                                                                    | Unverified against target route     | On disposable data, capture one complete response and persist both the Intake ID and backing work-item ID.                                                                                 |
| Idempotent create             | Plane create documentation does not state an idempotency-header guarantee. The current `planex intake create --idempotency-key` implementation describes a marker embedded in the editable description, not provider-enforced uniqueness. Existing work items can carry `external_source` and `external_id`, but deployed uniqueness is not proven. | Blocked                             | Prove an atomic provider idempotency key, or prove a deterministic unique correlation plus authoritative fetch. Otherwise ambiguous create goes to `manual_attention` with no blind retry. |
| Work-item identity            | Plane returns UUIDs and human sequence IDs.                                                                                                                                                                                                                                                                                                         | Documented; live shape observed     | Persist `(workspaceId, projectId, workItemId)` as identity. Treat key and URL as display data only.                                                                                        |
| Native attachments            | Official API documents credential acquisition, byte upload, and completion.                                                                                                                                                                                                                                                                         | Unverified on current CE deployment | Upload, complete, fetch, and delete a disposable attachment with the service identity. Record size, type, checksum mapping, IDs, access audience, and retention.                           |
| Webhooks                      | Official API documents delivery ID, event, HMAC signature, and retry behavior for work-item and comment events. A leased durable poller is approved for the initial topology.                                                                                                                                                                       | Deferred                            | Keep webhook processing disabled. Persist poll cursors, use multi-replica leases and fencing, and retain periodic authoritative reconciliation.                                            |
| Authoritative state fetch     | Work-item retrieval is available.                                                                                                                                                                                                                                                                                                                   | Read path verified                  | Prove the service identity can fetch the correlated item after webhook or poll discovery and observe versions/timestamps needed for ordering.                                              |
| Ready-for-retest signal       | Current BIZ state IDs are known, but the runtime destination is not selected.                                                                                                                                                                                                                                                                       | Blocked                             | Configure an allowlist of exact state IDs per destination project. Generic completed-state membership is not readiness.                                                                    |
| Reopen behavior               | Work-item state update is available to the current interactive identity.                                                                                                                                                                                                                                                                            | Unverified for runtime identity     | Configure exact reopen state ID and prove idempotent update plus authoritative observation outside readiness before another readiness generation.                                          |
| Durable reverse link          | `planex` exposes external-link operations.                                                                                                                                                                                                                                                                                                          | Unverified round trip               | Create, read, delete, and repair a disposable link or another provider-supported durable surface without overwriting developer edits. Persist its provider ID.                             |
| Rate limit                    | Official API states that rate limiting applies but does not publish the numeric policy used by this deployment.                                                                                                                                                                                                                                     | Blocked                             | Capture deployed response headers/limits and set bounded concurrency, backoff, and reconciliation cadence below them.                                                                      |
| Environment isolation         | Development base URL is known.                                                                                                                                                                                                                                                                                                                      | Blocked                             | Allowlist base URL plus workspace and project UUID per Checkmate environment. Prove development cannot route to production.                                                                |

Provider documentation used for the ledger:

- [Plane API authentication and response conventions](https://developers.plane.so/api-reference/introduction)
- [Create a work item](https://developers.plane.so/api-reference/issue/add-issue)
- [Create an Intake work item](https://developers.plane.so/api-reference/intake-issue/add-intake-issue)
- [Native attachment upload overview](https://developers.plane.so/api-reference/issue-attachments/overview)
- [Plane webhooks](https://developers.plane.so/dev-tools/intro-webhooks)

Provider documentation is not deployed-runtime proof.

## Required state machines

The defect lifecycle, outbound delivery, and inbound delivery are independent. A delivery retry must not be represented as a defect-state transition.

### Defect cycle

```text
intake_pending -> intake_open -> work_item_open -> ready_for_retest -> validated
                                      ^                  |
                                      |-- failed retest -|
```

Exceptional terminal or operator states are `intake_rejected`, `canceled`, `superseded`, `orphaned`, and `manual_attention`.

Invariants:

- At most one active defect cycle exists for a Checkmate test-run step.
- `openingRevisionId` is immutable.
- `currentEvidenceRevisionId` advances only with eligible same-issue human evidence.
- `readinessGeneration` is a local monotonic counter accepted from a newer valid external transition, never a provider timestamp.
- Readiness applies only when the linked revision is still current, the test remains included, and the run remains `Active`.
- A human `Passed` result is authoritative. It validates the cycle and makes later readiness events no-ops while leaving Plane workflow state under developer control.
- After a failed same-issue retest, no new readiness generation is accepted until reopen delivery succeeds, authoritative Plane state is observed outside readiness, and a later transition re-enters readiness.

### Outbound delivery

```text
pending -> leased -> delivered
   ^         |          |
   |         v          v
 retry_due <- failed   correlated
                   \-> manual_attention
```

Invariants:

- Result revision, current result projection, defect-cycle mutation, and deterministic outbox insert commit in one MySQL transaction.
- Every immutable result revision records server-derived tenant, actor, and provenance. The server never trusts a client-supplied integration source.
- Only an authenticated human Checkmate save may produce a human `Passed` result. System transitions record immutable `actor_type`, `source_system`, `source_event_id`, and `defect_cycle_id` fields and cannot impersonate a human result.
- A worker claims due rows in a short transaction with a random lease token and expiry, then performs the network call outside the transaction.
- Finalization requires the same row ID and lease token. Expired leases are recoverable.
- Ambiguous creates are never retried blindly.
- Ticket creation and each attachment upload have independent visible delivery states.
- The global creation kill switch stops new Plane resources while allowing safe synchronization and reconciliation for already-correlated cycles.

### Inbound delivery

```text
received -> signature_verified -> persisted -> authoritative_fetch -> applied
                  |                               |                 |
                  v                               v                 v
               rejected                       retry_due          no_op
                                                    \-> manual_attention
```

Invariants:

- Persist the raw verified event in an inbox keyed by provider delivery ID before acknowledging it.
- A webhook is a hint. Fetch authoritative Plane state before changing Checkmate.
- Duplicate delivery IDs and already-applied provider transitions are no-ops.
- State mutation locks the exact `testRunMapId`, active cycle, and current result revision in one transaction.
- Polling, if required, uses persisted cursors and multi-replica leases, not an in-memory timer.
- Periodic reconciliation remains enabled even when webhooks are working.

## Current Checkmate gaps

These are **verified source** at Checkmate commit `38926ec015eb19550833528512b655ac065729a1`:

- `app/db/dao/testRuns.dao.ts` updates current result rows separately from an unawaited history insert and toggles foreign-key checks around the insert. Result and history are not atomic.
- The reset-to-`Retest` path repeats the separate update and unawaited history behavior.
- `app/db/schema/runs.ts` has no unique `(runId, testId)` constraint on `testRunMap`; duplicate aggregate rows are schema-valid.
- Route-level `Active` checks and later DAO updates are separate, so result changes race run locking or archival.
- `app/routes/api/v1/uploadAttachment.ts` writes S3 before a durable revision reference exists.
- `app/routes/api/v1/deleteAttachment.ts` can delete a valid-format key without proving revision ownership or removing database references.
- No transactional outbox, inbox, immutable result revision number, command fingerprint, defect cycle, durable retest notification, or operator reconciliation record exists.

BIZ-39 must address these as an additive, disabled-first foundation. It must not reuse the bulk `RunReset` operation for a single Plane-linked result.

## Migration and data-preservation gates

The Checkmate database and S3 data are irreplaceable. No destructive reset, down migration, PVC deletion, or schema recreation is allowed.

**Verified source** at infrastructure commit `dc9fc6b9ed4fee5b1ec9352fa4a13b8c17cda5c2`:

- The migration Job waits only for TCP port 3306, runs `yarn db:schema:push`, and has `wait_for_completion = false`.
- The application depends on creation of the Job resource, not successful Job completion.
- Development uses one 10 GiB gp3 MySQL PVC.
- No automated snapshot, database dump, restore workflow, or tested recovery runbook is present in the inspected source.

Before any database-touching deployment:

1. Generate and inspect additive SQL from the exact release commit.
2. Test expand and backfill behavior on a production-like clone, including duplicate-map detection and DDL lock impact.
3. Repair deployment gating so migration success is required before the application rolls forward.
4. Capture a backup of the exact database and storage identities.
5. Restore that backup into an isolated target and verify row counts, representative result histories, attachment references, and application readability.
6. Deploy compatible schema, then compatible application with every integration flag off.
7. Stop on destructive drift, failed migration, failed restore verification, or unexplained reconciliation differences.

## Runtime configuration and proof still required

The destination policy is approved: the development BIZ project, Backlog for creation, Done for readiness, Todo for same-issue reopen, leased polling, Aza Kai for initial triage and manual attention, BIZ-member evidence visibility, source-owned retention without automatic deletion, and a dedicated service identity using disposable verification data.

The following still block automatic enablement:

- Create the dedicated service identity and prove its least-privilege permissions against the configured base URL, workspace UUID, project UUID, and exact state UUIDs.
- Prove create correlation, attachment round trip, authoritative fetch, reopen, durable reverse-link repair, and environment isolation using disposable development data.
- Configure permitted evidence fields and file types, tester-facing disclosure, runtime priority and labels, escalation timing, and a durable tester notification recipient and channel.
- Measure deployed rate-limit behavior and configure bounded worker concurrency, backoff, and reconciliation cadence.
- Demonstrate the additive migration on a production-like clone and restore a verified backup before any database-touching deployment.

## Phase boundaries

### BIZ-37 exit

BIZ-37 can complete only when every unresolved runtime value above has an approved value or an explicit decision to defer with the dependent feature disabled, and the disposable provider checks prove or reject the remaining Plane contracts.

### BIZ-39 entry

BIZ-39 may implement generic atomic result revisions, command fingerprinting, aggregate identity, transactional outbox/inbox primitives, revision-owned attachment metadata, and durable notifications behind disabled flags only after its migration and retention fields are settled. Result revisions must preserve server-derived tenant, authenticated actor, actor type, source system, source event, and defect-cycle provenance; external events cannot create human results. It must not encode destination-specific readiness, automatic reopen, evidence copying, or notification policy from assumptions.

Until a reviewed metadata backfill is complete, the flag-on history reader has a narrow compatibility path for legacy screenshots: it may sign only a valid `test-run-attachments/<uuid>-<filename>` key that was already returned by the requested run/test history query and has no result-attachment metadata row. Any metadata-bearing attachment must be committed and match that exact run/test scope. New revision attachments never use this compatibility path.

### Enablement

Automatic creation remains blocked until:

- create idempotency and authoritative correlation are proven;
- a restorable Checkmate backup is demonstrated;
- additive migration and completion gating pass on a production-like clone;
- evidence access and retention are approved;
- authenticated-human-only `Passed` behavior and immutable server-derived revision provenance pass route, domain, and database tests;
- runtime routing, triage ownership, and manual-attention ownership are configured and read back;
- signed webhook or leased-poller behavior is proven;
- the end-to-end loop passes using disposable Checkmate and Plane data.

Source review, unit tests, CI, migration execution, deployment, and authenticated runtime acceptance are separate evidence gates. None substitutes for another.

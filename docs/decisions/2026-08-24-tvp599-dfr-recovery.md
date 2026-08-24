# ADR: TVP-599 DFR recovery

Status: operator-run, source-only implementation. This is a one-execution recovery for exactly two records. It does not change the normal Plane delivery or retest-readiness workers.

## Exact contract

The immutable recovery id is `tvp599-dfr-recovery-20260824`. The manifest contains exactly two ordered records and no additional keys:

| record | project/run/test | map/cycle/revision/outbox | BIZ intake / work item | source |
| --- | --- | --- | --- | --- |
| BIZ-41 / map386 | 4 / 17 / 394 | 386 / 1 / 1 / 1 | `fe8b9bb8-bcbe-4ff9-a09c-ec9f9a402aae` / `48eef479-5be4-4356-a77d-a0c881e5cff7` | `manual_attention` |
| BIZ-42 / map336 | 5 / 14 / 423 | 336 / 2 / 2 / 2 | `1acae908-d0ca-431f-8eb2-0d1ba812a8df` / `56e3d756-b6b8-44dd-97a0-d21e5cb42c44` | `intake_open` |

The DFR route is workspace `e36dfd86-953a-4e33-a410-856208893bb9`, project `65452c58-ac2a-4077-a91d-40bf6b5cf4ec`, identifier `DFR`; the BIZ source route is the same workspace, project `67726ee5-7d0c-4656-8bc8-b2f8a959d5da`, identifier `BIZ`. The manifest also carries the exact correlation, title, revision number, sequence, source state, and payload digest for each record. BIZ-41's digest is the fixed value `2be2537060cd11f4127efe99f599fbb9d61beea96443af679114eff3c81bf61d`.

BIZ-42's digest is intentionally not source data. It must be supplied by the canonical immutable runtime manifest produced during restored-backup ORM preflight and compared to the exact ORM `resultOutbox.payload` row. It must never be derived from a guess, copied into source, or accepted without the ORM comparison.

Object keys are sorted for canonical JSON; array order is significant. `sha256` is SHA-256 of the canonical manifest object with the `sha256` field removed. The implementation rejects missing, extra, reordered, mixed, or mismatched records before any provider write or ORM mutation.

## Operator environment and preflight

Run one noninteractive process with `NODE_ENV=production`, `PLANE_TVP599_DFR_RECOVERY_ENABLED=true`, `PLANE_TVP599_DFR_RECOVERY_WRITE_GATE=true`, and `PLANE_DESTINATION=dfr-development`. The manifest and pod must carry the exact Checkmate bot actor UUID and stable identity; both are compared against `/users/me` on BIZ and DFR. All normal workers must be present and exactly `false`:

```text
PLANE_DELIVERY_WORKER_ENABLED=false
PLANE_RETEST_READINESS_ENABLED=false
PLANE_RETEST_READINESS_WORKER_ENABLED=false
PLANE_TVP599_DFR_RECOVERY_ENABLED=true
PLANE_TVP599_DFR_RECOVERY_WRITE_GATE=true
PLANE_CHECKMATE_BOT_ACTOR_ID=<exact-actor-uuid>
PLANE_CHECKMATE_BOT_ACTOR_IDENTITY=<exact-stable-actor-identity>
```

The Plane API key is process-local and is never printed. Before execution, an operator must verify the exact reviewed application image digest (an `image@sha256:<operator-supplied-digest>`, never a mutable tag), take a restorable database backup, and complete a restore test. The restored ORM preflight must read back both exact source rows, payload digests, source snapshots, active cycles, opening/current evidence revisions, revision numbers, event type/key/correlation, evidence lease/artifact state, and outbox rows, then emit the canonical manifest. BIZ-42's digest is obtained from this restored-backup ORM preflight. A mismatch is a stop/manual-attention result; the job never invents a digest.

The recovery is a Kubernetes `Job` only: one pod (`completions: 1`, `parallelism: 1`), `backoffLimit: 0`, `restartPolicy: Never`, exact image digest, and all normal Plane workers false. Do not add a CronJob, reusable worker, or deployment flag enablement. Arbitrary, missing, or true worker values fail closed.

## Saga and no-retry rule

The service deterministically reserves and fences both records in ORM state, including active markers, opening/current evidence revisions, revision numbers, event identity, correlation, and every manifest evidence row, then releases database locks before calling Plane. Duplicate lookup paginates every collection page within a bounded cap and exact-matches correlation; a match beyond page one prevents POST, multiple matches stop, and malformed/repeated/capped pagination fails closed. Zero matches permits one create; one match is accepted only after complete identity/route readback. If a POST is ambiguous, the service performs only the exact correlation lookup and readback. It never retries the POST.

Finalization is one exact affected-row-count ORM transaction: it re-locks and revalidates the current cycle, revision, outbox payload/lease/routes, and manifest evidence immediately before mutation. It relinks only explicitly enumerated pending, artifact-free evidence rows; completed BIZ evidence and provider artifact IDs remain historical audit. Unknown, mixed, leased, or artifact-bearing rows outside the declared preserved set stop. Reconciliation snapshots persist preserved/relinked IDs and counts. Exact-terminal no-op requires cleared leases, delivered timestamps/URL, DFR route/intake/work item/sequence/state, exact route-only outbox payload, exact cycle, and exact evidence disposition; any inconsistency takes the fenced/manual-attention path. Other payload fields and the immutable source snapshot are preserved. A commit or fence failure never deletes a DFR item; it records reconciliation evidence and leaves both records in manual attention. BIZ originals are never deleted or transitioned artificially. After a successful commit, one idempotent marker comment is added to each original; a comment failure is operator-visible partial success.

Rollback is a reviewed database restore or a subsequent fenced reconciliation. Do not delete a provider item or issue ad hoc destructive SQL.

## Round-2 operator checks

The manifest record also fences `isIncluded`, `currentResultRevisionId`, and
the exact `projectId/runId/testId` map join. The ORM readback and both
reservation/finalization transactions lock and revalidate that map, the active
cycle (`activeMarker`, opening/current evidence revision), the result revision
(`resultRevisionId` and `revisionNumber`), and the outbox `eventType`,
`eventKey`, correlation, and top-level payload tuple. Any stale or missing
field is a manual-attention stop; no inspected payload is reused after a
concurrent change.

Evidence manifests enumerate every row. `preserve` rows must retain the exact
provider work-item/comment/asset/attachment IDs, route, state, and
`deliveredOn` timestamp. Only explicitly enumerated `pending` rows with no
lease, timestamp, or provider artifact may be relinked; `reserved`, `retry_due`,
`manual_attention`, mixed, or artifact-bearing rows are rejected. A pending,
artifact-free DFR-linked result with cleared leases, exact cycle, exact route,
and route-only outbox rewrite is a complete one-off rerun no-op; normal
evidence delivery remains responsible for its later delivery.

The authoritative DFR GET must provide the exact sequence. A POST response
sequence is never used as a fallback. A timed-out or otherwise ambiguous POST
is followed only by bounded exact-correlation pagination and readback; the
POST is never retried. The duplicate lookup must inspect every cursor/page
within its safety cap, reject malformed/repeated/capped pagination, and stop on
more than one exact match.

The CLI captures recovery and write-gate authorization from explicit process
environment before dotenv/config loading. Values supplied only by dotenv do
not authorize either gate. The pod must still set every normal worker flag to
the literal `false`, the recovery gate and narrow write gate to literal `true`,
and `PLANE_DESTINATION=dfr-development`. Keep this as one noninteractive Job
with `completions: 1`, `parallelism: 1`, `backoffLimit: 0`, and
`restartPolicy: Never`; do not add a CronJob or enable deployed workers.

## Round-3 fail-closed gates

The source outbox is an already-delivered BIZ record, not a retry queue: both
rows must read back as exactly `delivered` with a non-null `deliveredOn`, a
null lease token/expiry, null `lastError`, and the manifest's exact BIZ
provider work item, intake, sequence, URL, state, and correlation. `pending`,
`leased`, `retry_due`, `failed`, `manual_attention`, or any other state stops
before access checks or Plane writes; no state is cast to `pending`.

An exact-terminal no-op is allowed only when the immutable BIZ source payload
snapshot is present in the recovery reconciliation row and its SHA-256 exactly
matches the manifest (including the full top-level tuple and BIZ intent route).
The first recovery persists that lossless snapshot before provider calls; a
rerun reads it back. Missing, corrupt, or mismatched snapshots are explicit
manual attention, never an inverse reconstruction or silent no-op.

Each evidence manifest entry declares provider artifact IDs, lease token and
expiry, delivery timestamp, and failure text. Relink entries must be exactly
`pending` with all those values null and no provider artifacts; preserved
entries must match every declared value exactly. Manual-attention updates are
fenced by outbox ID, aggregate/revision identity, event identity, payload
correlation, expected current state, lease expectation, delivered timestamp,
and affected-row count 1. A stale count is unresolved and never overwrites a
concurrent row. All persisted and operator-facing provider, database, and
caught errors pass through the bounded sanitizer; tokens, API keys, and
Authorization values are never persisted or printed.

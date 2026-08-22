# TVP-599 Slice 1: bounded Plane one-shot reconciliation

The `plane:reconcile-one-shot` command is an internal, operator-run canary for
one existing BIZ-41 defect cycle. It is disabled unless
`PLANE_CANARY_ONE_SHOT_ENABLED=true` is set in the ephemeral process. The
Plane API key is read from that process environment and is never printed.

The command requires exact `projectId`, `runId`, `testId`, work-item ID, Intake
ID, correlation key, and `biz-development` destination. It locks and validates
one included `testRunMap`, its Active run, one active defect cycle, current
result revision, and the exact Plane-create outbox tuple. It performs exactly
one bounded Plane `GET` for the supplied work-item ID. It never calls
`createIntake`, `POST`, or any normal delivery worker.

```sh
PLANE_CANARY_ONE_SHOT_ENABLED=true \
yarn plane:reconcile-one-shot \
  --project-id 123 \
  --run-id 456 \
  --test-id 789 \
  --work-item-id <existing-work-item-id> \
  --intake-id <existing-intake-id> \
  --correlation-key <exact-create-correlation> \
  --destination biz-development
```

The command is operator-only and must not run concurrently with the global
delivery or readiness workers. It refuses to run if any of
`PLANE_DELIVERY_WORKER_ENABLED`, `PLANE_RETEST_READINESS_ENABLED`, or
`PLANE_RETEST_READINESS_WORKER_ENABLED` is exactly `true`; the CLI prints a
warning when a permitted manual run starts.

The claim transaction resolves any unlocked candidate first, then revalidates
cardinality and locks in the human-save order: exact `testRunMap`, cycle,
outbox, and current revision. This map-before-cycle order avoids the lock-order
inversion with `saveHumanResult`; the normal worker's outbox claim is still
protected by the exact lease fence, and a deadlock/lease failure fails closed
with only a bounded three-attempt retry for MySQL deadlock (`ER_LOCK_DEADLOCK`,
errno `1213`, or SQLSTATE `40001`). Each retry opens a fresh transaction and
lease token; lock timeouts and other errors are never retried. Before the GET,
it leases the exact outbox and durably
reserves the exact cycle in `manual_attention` when needed. That reservation is
the crash/expired-lease fence: the normal create worker will not create while
the one-shot owns the reconciliation path, and this one-shot is the only path
that may reclaim that state. If the outbox lease update affects zero rows, the
claim transaction throws so the cycle reservation cannot commit by itself. A
mismatch or provider/transaction error keeps the cycle and exact outbox in
`manual_attention`; a concurrent lifecycle transition (for example
`ready_for_retest`) is never overwritten.

The command reports only a redacted JSON summary. A successful reconciliation
attaches the already-observed provider IDs/state and marks only the exact
leased outbox row delivered in one transaction, fenced by the lease token,
cycle lifecycle/current-revision/correlation, reserved state, and expected
provider IDs. Replaying the same complete stored IDs/state is a matched no-op
even after the cycle moves to `ready_for_retest`, `validated`, or another
legitimate inactive post-delivery state. Replay resolves the unique historical
cycle and delivered outbox by the full tuple, validates the stored provider
identity/state, correlation, and destination, and requires `deliveredOn` with
both lease fields cleared before returning a no-op. It performs no lifecycle
reactivation or write. Provider, tuple, lease, uniqueness, or transaction
ambiguity fails closed. If all bounded deadlock attempts fail, the command
leaves the exact rows in manual attention for an operator; it never repeats a
successful provider GET. All
adapter errors are sanitized before operator output or persistence. The
command reuses the existing schema and makes no HTTP endpoint or migration
change. An opt-in disposable MySQL 8 regression is available with
`CHECKMATE_MYSQL_HARNESS_URL=mysql://...@127.0.0.1:3306` and
`yarn test:plane-one-shot:mysql`; it creates and drops a short random temporary
database, verifies inverse cycle-before-map contention is recovered by the
bounded map-before-cycle retry while the peer commits, verifies normal
map-before-cycle concurrency, and verifies claim-failure rollback. It refuses
non-local hosts, requires MySQL 8, and has bounded cleanup/signal teardown.
Without that variable it prints `SKIPPED` and makes no database connection.

# Local mode for issue #18

Status: bridge design approved. Ultimate trial available. Implementation and real LocalStack verification in progress; final evidence belongs in examples/localstack/README.md.

## Required outcome

Two separate checkouts run the same SST application concurrently. Each owns its LocalStack instance, volumes, state, ports, workers, and bindings. Actual Node.js/TypeScript handlers execute in the host checkout, using LocalStack S3, SQS, and PostgreSQL through the RDS Data API. Ordinary AWS workflows remain default and unchanged.

The acceptance contract is [issue #18](https://github.com/Bluestone-Health/sst-v2/issues/18). An example in this repository, linked to this fork's built `packages/sst/dist`, is the reproducible artifact. No Scheduler port, native-Postgres substitution, cloud-stage deployment, or general AWS provider abstraction is part of this work.

## Findings at `8ca055913`

- `Function.ts` selects `support/bridge/live-lambda.ts` for live development and defers bootstrap/IoT permissions. The bridge initializes IoT at module load and optionally transports large responses through S3. It cannot serve as the offline bridge.
- `runtime/workers.ts`, `runtime/server.ts`, `runtime/handlers.ts`, and `runtime/handlers/node.ts` already supply compilation, file watching, worker threads, Lambda Runtime API delivery, and success/error events. Reuse these contracts.
- The runtime server currently listens without an explicit interface. Worker startup is asynchronous, current request tracking is per worker, and the Runtime API queues invocations per worker. The local transport must isolate or serialize requests and terminate timed-out workers; merely adding an HTTP endpoint is insufficient.
- `project.ts` initializes `.sst` before the command handler. Local selection and state separation must happen before project initialization, not just inside the new command.
- `stacks/synth.ts` asks STS for identity and constructs the embedded CDK provider. `credentials.ts`, asset publishing, and bootstrap have their own AWS paths. Running the existing `dev` command with different resource bindings would still contact AWS.
- Bindings already provide `SST_<construct>_<property>_<id>` values. `RDSv2` exposes `clusterArn`, `secretArn`, and `defaultDatabaseName`; Scheduler uses these with `RDSData`, Kysely `DataApiDialect`, and direct batch statements inside transactions.
- `RDSv2` suppresses automatic migrations in dev mode. Its migration custom-resource Lambda is a raw CDK Lambda, as are the stack custom-resource handler and CDK bucket-notification helper. These need actual LocalStack execution/callback coverage, independent of ordinary SST live handlers.
- The imported-cluster migration path dereferences `cluster.secret`. The proposed example creates its cluster, so that unrelated import-path fix is not required.
- Issue #15 remains open; there were no open PRs when checked. Its direct-Postgres proposal does not satisfy this issue's Data API contract.

## Recommended invocation design

Use a separate, small LocalStack Lambda bridge. It forwards the event and Lambda context to an authenticated host endpoint and returns the handler result unchanged, including `batchItemFailures`. Errors, connection failures, worker exits, and deadlines become Lambda invocation failures. LocalStack owns event-source delivery, visibility, retries, and acknowledgements.

The host validates a per-environment secret and known function ID, uses the existing compiler and workers, and correlates replies by request and worker ID. The implementation uses a fresh worker per invocation to isolate globals and environment, and bounds build/execution time. Terminate the worker when the invocation finishes or times out. Preserve the existing cloud path unless a shared correctness fix is independently necessary and tested.

Keep the worker Runtime API on loopback in local mode. Expose only the authenticated bridge where containers can reach it. Document and test `host.docker.internal` on macOS and the Docker host-gateway mapping on Linux; do not assume loopback is container-accessible. Never accept arbitrary module paths or inherit the host's AWS credentials.

Alternative: a host HTTP/SQS adapter avoids Lambda containers but adds polling, event shaping, acknowledgement, retry, visibility, and partial-batch behavior to SST. It is less attractive unless the real bridge probe shows a concrete blocker. Do not implement both.

## Additive integration

Proposed entry point: `sst local`, with an explicit environment ID, LocalStack endpoint, and bridge address/port. User-managed Compose starts the containers. Keep the existing app's construct definitions and binding names.

Select this path before cloud credential resolution. Use dummy credentials, isolate local output beneath `.sst/local/<environment>`, avoid the IoT bridge/SST cloud bootstrap, and reject unsupported required constructs or runtime options with clear errors. Validate LocalStack targets and required capabilities before provisioning. Never fall back to AWS.

Try LocalStack's CDK-supported deployment path for the synthesized example before writing bespoke resource provisioning. Verify this fork's embedded toolkit and asset publisher explicitly. SDK v3 endpoint environment support is insufficient for SDK v2: configure and test both, including container custom resources and presigned callback URLs. Derive runtime bindings from deployed constructs rather than a second resource manifest.

After data resources exist, invoke the existing migration handler through the local invocation path. Readiness requires successful migration and Data API checks. Preserve data on code edits. Initially require an explicit, environment-scoped reset for resource/schema changes that cannot safely update; never delete another environment or unrelated containers.

## Implementation and verification order

1. Implement and exercise the transport with actual compiled Node handlers: result, thrown error, bounded timeout, concurrent calls, worker exit, and source reload. Add a small existing-framework regression test; direct handler imports do not count as runtime evidence.
2. With an authorized LocalStack token, prove one Lambda bridge invocation and one SQS round trip, including a failed invocation remaining retryable. Verify the actual container-to-host route before expanding provisioning.
3. Add local selection, endpoint/credential routing, minimal CDK integration, construct bindings, and migrations. Inventory and verify only the custom resources the example synthesizes. Reject unsupported configurations before deployment.
4. Add one tiny HTTP example: obtain presigned upload/download URLs, write/read S3, enqueue work, process S3-created notifications through SQS, and query migrated database state. Exercise Data API commit, rollback, and batch statements.
5. Run two checkouts concurrently with distinct markers and IDs. Check object/message/row/response isolation; edit A and prove B unchanged; interrupt/restart A's worker and prove retry; stop/reset A and prove B still works. Record outbound destinations to verify no AWS calls.
6. Build and run relevant regressions. Document exact versions, host/runtime, setup/start/readiness/logs/stop/reset commands, supported queue options, and observed limits. Measure cold start, cached-image readiness, edit feedback, and CPU/RAM for both environments. Commit the implementation and open a reviewable PR; do not merge or release.

## External prerequisites and evidence

Allen supplied access to an Ultimate trial through his local lstk installation. The token stays outside source and logs. Compose runs the emulator, Lambda containers, PostgreSQL, and persistent volumes on his Docker host; no Cloud Pods, remote hosting, or cloud snapshots are used. License activation and image/package downloads still require network access.

LocalStack documents RDS/Data API in its [commercial service coverage](https://docs.localstack.cloud/aws/licensing/) and [RDS documentation](https://docs.localstack.cloud/aws/services/rds/). Service coverage is not proof that this example's transactions, batch behavior, PostgreSQL version, or custom resources work. These remain real-integration gates. Its [Lambda documentation](https://docs.localstack.cloud/aws/services/lambda/) lists SQS partial-batch responses; verify the selected version rather than claiming full AWS parity.

Available host tools: Node 26.9.0, pnpm 10.12.3, Docker Engine 29.4.0 through OrbStack. The target handler/runtime check remains Node 22. Locked dependencies installed without changing the lockfile. Baseline `pnpm --dir packages/sst build` passed. The 209 focused construct/project regressions passed. No real AWS stage has been used.

# SST local example

Experimental, opt-in `sst local` for Node.js handlers, S3, standard SQS, and PostgreSQL via RDS Data API. A LocalStack Lambda forwards to SST's existing compiler, watcher, and worker runtime. LocalStack owns event delivery and retries; every invocation gets its own host worker.

## Requirements

- Node **22**, pnpm 10, and Docker with its socket available.
- A LocalStack entitlement covering RDS/Data API and your intended use. Verification uses an Ultimate trial. Supply `LOCALSTACK_AUTH_TOKEN` through your shell's environment; never put it in this repository. No AWS profile or real AWS credentials are needed.
- Free ports 4567 (LocalStack), 13559 (authenticated bridge), and 3001 (loopback web UI). Every concurrent checkout needs different ports, environment ID, and Compose project.
- Allow several GB of Docker memory for two instances plus Lambda containers; measured usage is recorded below.

The pinned image runs locally. Data and artifacts stay in Docker volumes and each checkout's `.sst/local/<id>`; this example does not use Cloud Pods, remote hosting, or cloud snapshots. Telemetry is disabled. License activation and image/runtime downloads still contact their providers; this is not air-gapped operation. See [LocalStack configuration](https://docs.localstack.cloud/aws/customization/configuration-options/) and [local persistence](https://docs.localstack.cloud/aws/developer-tools/snapshots/persistence/).

## Start one checkout

From the repository root, using Node 22:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir packages/sst build
cd examples/localstack
pnpm install --ignore-workspace --frozen-lockfile
export COMPOSE_PROJECT_NAME=sst-issue18-a LOCALSTACK_PORT=4567
# LOCALSTACK_AUTH_TOKEN must already be exported in this shell.
docker compose up -d --wait
MARKER=alpha pnpm local --env a --endpoint http://127.0.0.1:4567 --port 13559
```

Wait for `Local ready`, which follows successful deployment and migration. In another terminal in this directory:

```sh
node server.mjs a http://127.0.0.1:4567 3001
```

Leave that server running. In a third terminal in the same directory, run the automated smoke test:

```sh
node smoke.mjs http://127.0.0.1:3001 alpha
```

Open <http://127.0.0.1:3001>. The flow invokes a real local handler, uses SDK v2 presigned S3 PUT/GET URLs, sends SQS work through SDK v3, and reads the migrated PostgreSQL table through Kysely's Data API dialect. The smoke test also commits and rolls back batch writes and rejects a tampered presigned URL. Presigned URL signature validation is enabled in Compose; see [LocalStack S3 signature validation](https://docs.localstack.cloud/aws/services/s3/). Upload notifications take the S3 → SQS → local consumer path.

Edit `src/version.ts` or a handler and invoke again; SST rebuilds code without replacing data resources. Logs include the environment and Lambda request ID. An invalid edit fails the invocation instead of serving the previous build. For infrastructure changes, stop and restart SST; use the explicit reset below if LocalStack cannot update the resource reliably. This is not a promise of complete CloudFormation update parity.

Stop SST and the web server with Ctrl-C; data remains while LocalStack runs. **LocalStack snapshots are disabled:** stopping/restarting the Docker project resets its resource state. After a Docker restart, reset its volume and local state before provisioning again. To reset **only this environment's data**, stop its processes first, confirm `COMPOSE_PROJECT_NAME` and then:

```sh
docker compose down --volumes
rm -rf .sst/local/a
```

Do not run global Docker prune commands. A second checkout uses `sst-issue18-b`, env `b`, marker `beta`, and ports 4568/13560/3002. It has its own source files, dependencies/build, state, volume, network, and workers.

## Reproduce isolation and failure checks

Build and install **both separate checkouts** as above. Stop existing example SST/web processes. From A's `examples/localstack`, with the token exported:

```sh
node verify-isolation.mjs /absolute/path/to/checkout-b
```

This script owns the `sst-issue18-a` and `sst-issue18-b` Compose projects and the ports listed above. **It deletes A's Docker volume** to test reset isolation, then stops both projects; B's volume remains, but its resource state is not restored on restart. Do not use those project names for unrelated data. It starts both environments concurrently, runs the HTTP smoke test, checks bindings and marker separation, edits only A, crashes a consumer worker, restarts SST with pending work, then proves B still works after A is reset. It prints startup/edit timings, Docker/process memory and CPU, and the temporary log directory. Host provisioning uses a verification-only network guard that rejects HTTP/SDK/fetch destinations outside local hosts; the example handlers use the same guard.

Lower-level transport and database reproductions (from `packages/sst`, with LocalStack already on 4567):

```sh
node test/runtime/localstack.mjs
node test/runtime/localstack-rds.mjs
pnpm test test/local.test.ts test/asset-schema.test.ts
```

## Supported scope and limits

- Node.js/TypeScript only. Workers run the host Node version: use Node 22 for this example. Python handlers, container Lambdas, non-SQS event-source mappings, cloud context lookups, and services outside the local resource allowlist fail explicitly. The [Scheduler resource example](../localstack-scheduler/README.md) covers FIFO/cross-stack SQS, HTTP APIs, DynamoDB, SNS, packaged Node Scripts, Jobs, and site bindings. Imported SQS sources must resolve to a queue in the same assembly.
- Standard SQS batching and `ReportBatchItemFailures` are preserved. Errors, worker crashes, disconnects, and timeouts return Lambda failures for LocalStack to retry. This does not claim AWS production timing or complete FIFO/IAM/API Gateway parity.
- Application SDK v3 clients use `AWS_ENDPOINT_URL`; SDK v2 clients must receive the endpoint explicitly. SQS clients should use `useQueueUrlAsEndpoint: false`, because CloudFormation may return its internal port in queue URLs. SST rewrites bound queue URLs for host workers. Do not hard-code real AWS endpoints in local handlers.
- The bridge listens on the host for Docker access and requires a random per-environment bearer token. The unauthenticated Lambda Runtime API and web UI are loopback-only. Keep `.sst/local` private: it contains tokens, synthesized templates, logs, and local database credentials. One process owns each environment via a PID lock.
- Compose sets Docker's `host.docker.internal:host-gateway` route and a per-project Lambda network. This route is verified on macOS/OrbStack. The Linux host-gateway configuration is supplied but has not been run on Linux or Docker Desktop in this test.
- Raw CDK helper Lambdas execute in LocalStack containers; SST functions, including the existing RDSv2 migration handler, execute on the host. No SST IoT bridge or SST cloud bootstrap is used. The embedded CDK toolkit's bootstrap/assets, S3-notification callback, and migration callback are exercised locally.
- Ordinary commands retain AWS defaults. The separately committed schema-reader alignment fixes the existing CDK 53/publisher 44 mismatch; revert that commit independently if needed. No deployment-mode toggle or toolkit upgrade was added.

## VSCode launch configuration

The `.vscode/launch.json` file includes configurations for debugging LocalStack Lambda workers and launching the LocalStack server. Use the compound configuration "LocalStack: app + Lambda debugging" to start both concurrently.

```json
{
  // Use IntelliSense to learn about possible attributes.
  // Hover to view descriptions of existing attributes.
  // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "LocalStack: Lambda workers",
      "runtimeExecutable": "${env:HOME}/.local/share/fnm/node-versions/v22.23.0/installation/bin/node",
      "program": "${workspaceFolder}/packages/sst/dist/cli/sst.js",
      "cwd": "${workspaceFolder}/examples/localstack",
      "args": ["local", "--env", "a", "--endpoint", "http://127.0.0.1:4567", "--port", "13559"],
      "env": { "MARKER": "alpha" },
      "console": "integratedTerminal",
      "autoAttachChildProcesses": true,
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/examples/localstack/.sst/local/a/artifacts/**/*.mjs", "${workspaceFolder}/examples/localstack/.sst/local/a/artifacts/**/*.js"],
      "resolveSourceMapLocations": ["${workspaceFolder}/**", "!**/node_modules/**"],
      "skipFiles": ["<node_internals>/**"],
      "preLaunchTask": "localstack: build SST"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Localstack Config",
      "runtimeExecutable": "${env:HOME}/.local/share/fnm/node-versions/v22.23.0/installation/bin/node",
      "cwd": "${workspaceFolder}/examples/localstack",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/examples/localstack/server.mjs",
      "console": "integratedTerminal",
      "args": ["a", "http://127.0.0.1:4567", "3001"]
    }
  ],
  "compounds": [
    {
      "name": "LocalStack: app + Lambda debugging",
      "configurations": ["LocalStack: Lambda workers", "Launch Localstack Config"],
      "stopAll": true
    }
  ]
}

```

## Verification evidence

Snapshot persistence was explicitly deferred after observed snapshot-save timeouts and PostgreSQL connection failures on restore. Reproduce the rejected configuration by setting `PERSISTENCE: "1"` in a disposable copy, running the isolation script, and restarting it with the same volumes. Logs reported `waiting on snapshot save timed out` and `DatabaseErrorException`; no cloud snapshots were involved.

Tested on 2026-09-26: Apple M5 Pro (18 cores), 64 GiB RAM, macOS 26.6.2, OrbStack/Docker Engine 29.4.0 (15.66 GiB available to Docker), Node 22.23.0, pnpm 10.12.3. LocalStack 2026.8.4 (build f26fc4d36, Ultimate trial), pinned by digest in Compose. CDK 2.253.0, toolkit 1.1.1, cdk-assets 3.3.1, schema reader 53.23.0. LocalStack reports the requested RDS engine version as 17.7, but `SELECT version()` returns **PostgreSQL 17.11**; exact AWS patch-version parity is not claimed.

Verified with real resources and workers:

- Two managed Git checkouts, distinct markers/ports/volumes and resource bindings; S3 and SQS events produced rows only in their own PostgreSQL instance.
- Twelve concurrent cold invocations with isolated bindings/request IDs, error, timeout, worker exit, valid and broken source edits, and recovery.
- SDK v2 SigV4 S3 URLs accepted and tampered URLs rejected with HTTP 403 in both environments; SDK v3 SQS/Data API; Kysely migration, commit/rollback and batch statements; S3-created notification through SQS.
- A-only edit left B unchanged. A consumer crash redelivered successfully. Messages sent while SST A was stopped survived and completed after restart. Resetting A's Docker volume left B's reads and a second complete smoke flow working.
- Host provisioning network guard recorded only `127.0.0.1:4567/4568` and their LocalStack S3 virtual-host domains. Handler guards reject nonlocal HTTP/SDK/fetch destinations. Docker logs verified local custom-resource callbacks; this is not an OS-level network sandbox for arbitrary user code.
- `pnpm --dir packages/sst build` passed. Final `pnpm --dir packages/sst test` under Node 22: **1,030 tests, 36 files passed**, 47.80 seconds. This includes existing nonlocal construct/binding regressions plus schema, semaphore, migration-error and real-worker checks. No real-AWS smoke deployment was performed.

Measured no-snapshot run (images already cached, fresh Docker volumes): Container launch through migration/readiness **72.7s A / 67.4s B**; the SST CLI portion was **61.1s each** after Docker health. Cached SST restart with existing resources **3.0s**. Code-edit-to-result **2.0s**. Cold image download is unmeasured because the image was already installed; no shared Docker image cache was removed for benchmarking.

An idle sample after both workloads: LocalStack **809/816 MiB**, its ten Lambda containers **975 MiB total** (roughly **2.5 GiB Docker total**), SST processes **441/351 MiB RSS**, web servers **66/64 MiB RSS**. Sample Docker CPU: LocalStack **1.01%/4.41%**, Lambda containers each **0.02–0.17%**; host SST/web CPU **0%** at the sample. These are one-time observations, not peak-memory or throughput guarantees. During concurrent startup, LocalStack alone reached a sampled **11.9%/34.9% CPU** and **776/723 MiB**. The script prints fresh measurements for your hardware.

References: [issue #18](https://github.com/Bluestone-Health/sst-v2/issues/18), [LocalStack Lambda](https://docs.localstack.cloud/aws/services/lambda/), [RDS](https://docs.localstack.cloud/aws/services/rds/), [CDK integration](https://docs.localstack.cloud/aws/connecting/infrastructure-as-code/aws-cdk/).

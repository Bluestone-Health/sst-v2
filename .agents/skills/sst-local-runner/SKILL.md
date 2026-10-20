---
name: sst-local-runner
description: Run and debug this SST v2 fork with Docker LocalStack, isolated local Lambda workers, RDS Data API, and CodeBuild. Use for sst dev --local, local environment replication, local resource compatibility, or preparing headless local-runner checks.
---

# SST local runner

Use this workflow for local emulation. Ordinary `sst dev`, `deploy`, and `bind` retain AWS behavior. Select `--local` explicitly for runner, bind, and secret commands.

Read [the base walkthrough](../../../examples/localstack/README.md) for the S3/SQS/PostgreSQL fixture. Read [the Scheduler resource walkthrough](../../../examples/localstack-scheduler/README.md) for HTTP APIs, FIFO queues, DynamoDB, SNS, Jobs, and site bindings. Follow the selected fixture's commands; do not combine their environment IDs or ports.

## Preflight and credentials

- Use Node 22, pnpm 10, Docker Compose, and a working Docker daemon socket. Jobs and Lambda helpers spawn containers. The Scheduler overlay needs an absolute host bind directory, not only a named volume.
- Inspect existing processes, Compose projects, and `.sst/local/<id>/session.lock` before starting anything. Reuse an environment only when it belongs to this task. Otherwise choose a separate checkout, environment ID, Compose project, LocalStack port, bridge port, and frontend ports.
- Use an authorized LocalStack entitlement covering RDS Data API, CodeBuild when needed, and the intended developer/agent or CI use. Ask for missing license decisions; do not buy a plan or assume a trial permits the intended use.
- On a developer machine, `lstk login` performs interactive login and stores a developer credential. It is unnecessary when an authorized token is already supplied. **This repository starts Docker Compose, which does not read the `lstk` keyring.** The launching shell must receive `LOCALSTACK_AUTH_TOKEN` from the developer's approved credential source. Ask for the source, never the token in chat. Do not extract keyring entries or change `~/.aws` as a setup shortcut.
- In CI/shared headless runners, have the workspace owner provide a **CI Auth Token** through the secret store as `LOCALSTACK_AUTH_TOKEN`. Do not run browser login, reuse a personal developer token, or assume AWS OIDC replaces the LocalStack credential. `lstk` itself is optional for the Compose workflow.
- Check token presence without printing it: `test -n "${LOCALSTACK_AUTH_TOKEN:-}"`. Never print the environment, expanded Compose configuration, or credential-bearing container metadata. No AWS SSO, AWS profile, or real AWS credentials are required; SST supplies dummy credentials and local endpoints.

LocalStack documents [token types and Docker injection](https://docs.localstack.cloud/aws/getting-started/auth-token/), [lstk login](https://docs.localstack.cloud/aws/developer-tools/running-localstack/lstk/authentication/), and [headless authentication](https://docs.localstack.cloud/aws/ci-pipelines/best-practices/). Recheck these if the installed CLI or licensing behavior differs; `lstk auth` is not the legacy `localstack auth` command.

## Start and bind

1. Install dependencies and build this checkout's `packages/sst`. Use the fixture's installation instructions and pinned image; do not substitute `latest` or start an unrelated default instance with `lstk start`.
2. Select and record `COMPOSE_PROJECT_NAME`, `LOCALSTACK_PORT`, environment ID, and bridge port. For CodeBuild, create a private absolute `LOCALSTACK_DATA_DIR` and retain it for this Docker project's lifetime. Use both `examples/localstack/compose.yaml` and `examples/localstack-scheduler/compose.yaml` as documented.
3. Keep Compose's `PERSISTENCE=0` and telemetry disabled. State stays on this machine/runner; do not use Cloud Pods, remote environments, replication from AWS, or cloud snapshot storage. License activation and image/package downloads still need network access; this is not air-gapped operation.
4. Start the selected Compose project. Verify `/_localstack/health` and `/_localstack/info` at its own endpoint. The latter should report `is_license_activated: true`; report the boolean/edition only, not a full configuration dump. A successful `lstk login` alone does not prove the Compose container has a valid license.
5. Load synthetic secrets, then start the app from its directory:

   ```sh
   pnpm exec sst secrets load secrets.example.env \
     --local --env scheduler --endpoint http://127.0.0.1:4569
   pnpm exec sst dev --local --env scheduler \
     --endpoint http://127.0.0.1:4569 --port 13561
   ```

   These values belong to the Scheduler **fixture**. Choose free values for another environment. `--env scheduler` produces stage `local-scheduler`; it is not an AWS dev-stage lease.

6. Wait for `Local ready`, after deployment and migrations. Keep SST running. Bind scripts and sites to the same ID and endpoint:

   ```sh
   cd site
   node ../../../packages/sst/dist/cli/sst.js bind --local --env scheduler \
     --endpoint http://127.0.0.1:4569 node check.mjs
   ```

   This is the documented fixture site-binding check. For another app, bind its actual script or dev server. The endpoint must be `http://127.0.0.1:<port>`. Bind discovers the active authenticated bridge; missing bridge state means start the matching runner, not fall back to AWS.

## Verify and diagnose

- Run the chosen walkthrough's smoke check only after readiness. The Scheduler fixture's smoke writes synthetic records and checks Jobs, retries/DLQ, SES capture, and manual schedule/email delivery. Its site-binding check currently asserts the documented port 4569; adapt that assertion in a disposable checkout if testing other ports.
- For changes to SST, build `packages/sst` before its tests: tests import `dist`. Use focused tests for the touched path and the full suite when changing shared constructs or runtime behavior. A running Docker container alone is not evidence that handlers, migrations, or business flows work.
- Read `.sst/local/<id>/outputs.json` and logs for that environment. Treat `.sst/local` as private: it contains bearer tokens and synthetic database credentials. Record logs at an explicit task-owned path. `LOCALSTACK_LOG_DIR` is a Scheduler smoke-reader setting, not automatic log redirection; use `tee` or shell redirection when file logs are needed.
- For local-only verification, use `examples/localstack/network-guard.cjs` as a Node preload on the runner/bound process after dependencies are installed. It covers worker HTTP/SDK/fetch traffic, not all process or Docker egress. Keep application integrations synthetic or local; the guard does not make arbitrary applications offline-safe.
- SDK v3 uses configured local endpoints. SDK v2 needs explicit endpoints; SQS v3 needs `useQueueUrlAsEndpoint: false`. Docker helpers/Jobs must reach the host bridge through `host.docker.internal`; `127.0.0.1` inside a container is not the worker host.
- For downstream Scheduler, install a tarball packed from the built `packages/sst/dist`, or the approved published artifact. Do not link a separate CDK installation or change downstream CDK/constructs pins to hide duplicate-class errors. Keep machine-specific `file:` overrides out of commits unless explicitly requested.
- Local Data API compatibility belongs in `src/runtime/local-data-api.ts` under `packages/sst`. Preserve SQL/error/transaction behavior; do not edit an application's historical migrations to accommodate the emulator. Existing workarounds cover narrow text projections and single dollar-quoted `DO` blocks, not arbitrary SQL.

## Headless execution and stopping

Use a runner that can run Docker containers and expose the host worker bridge to them, with host bind paths visible to the Docker daemon. A remote Docker daemon or restricted ECS task is not automatically compatible. Linux host-gateway configuration is supplied; the recorded end-to-end verification is macOS/OrbStack, so verify routing on the target runner before claiming CI support.

Inject the CI token, use a fresh task-owned environment, and supervise the long-lived SST process with bounded readiness/health waits. Run checks while it is alive. Capture private logs and stop only processes/Compose resources created by this job. This skill does not itself authorize changing CI workflows, adding secrets, or publishing artifacts.

Ask before interrupting an existing user-owned environment or deleting its data. Do not delete a lock until its recorded process is confirmed dead. Do not run global Docker prune or the destructive isolation verification script against a developer's environment. Snapshots are disabled: an SST restart preserves data while Docker stays running; a Docker restart requires a fresh local environment and checkout state reset as documented.

Host Lambda code reloads and supports breakpoints. Restart SST for infrastructure or Job code changes. Jobs run in CodeBuild containers; host breakpoints and cancellation are unavailable. Schedules are manual and inbound mail uses synthetic S3 injection. Keep these limits in the handoff.

Report the checkout/build, environment/stage, region, Compose project, endpoints, owned processes, log paths, checks, and remaining blockers. Do not report a successful deployment or full parity based only on synthesis.

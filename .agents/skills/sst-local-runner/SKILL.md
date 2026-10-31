---
name: sst-local-runner
description: Run and debug this SST v2 fork with Docker LocalStack, local Node Lambda workers, RDS Data API, and CodeBuild. Use for local environment setup, runner compatibility fixes, or headless execution prerequisites.
---

# SST local runner

Read the maintained walkthrough for the task:

- [Base fixture](../../../examples/localstack/README.md): S3, SQS, PostgreSQL and isolated checkout verification.
- [Scheduler resource fixture](../../../examples/localstack-scheduler/README.md): HTTP APIs, FIFO queues, DynamoDB, SNS, Jobs and site bindings.

Use those setup and smoke commands rather than reconstructing them. `sst dev --local` and `sst local` select this backend. Ordinary SST commands retain AWS behavior; bind and secrets operations also need explicit local mode.

## Prerequisites

Use Node 22, pnpm 10 and Docker Compose with a working Docker socket. Lambda helpers and Jobs spawn containers. CodeBuild needs the documented host bind directory. Containers must reach host workers through `host.docker.internal`; remote Docker or restricted container runners need that topology verified separately.

Use an authorized LocalStack entitlement for the required services and execution context. Developer login uses `lstk login` when needed, but Compose does not read its keyring: inject `LOCALSTACK_AUTH_TOKEN` through an approved credential source. Headless/shared CI uses a dedicated CI Auth Token from the runner's secret store, without browser login. Missing credentials or licensing are prerequisites to resolve with the operator, not a reason to switch backends.

Check token presence without printing its value. Do not dump expanded Compose configuration or container credentials. This runner needs no real AWS credentials or profile setup. Consult LocalStack's [authentication](https://docs.localstack.cloud/aws/getting-started/auth-token/) and [CI guidance](https://docs.localstack.cloud/aws/ci-pipelines/best-practices/) if the installed version behaves differently.

## Operate and verify

- Inspect existing processes, environment locks and Compose projects first. Use distinct checkout/state, environment ID, project, and ports for concurrent environments. Do not interrupt another task's session.
- Use the pinned Compose image and overlay for the selected fixture. Keep snapshots and telemetry disabled. Do not use Cloud Pods, remote environments, or AWS replication. Activation and package/image downloads still require network access.
- Load synthetic secrets only. Wait for `Local ready`, after deployment and migrations, before smoke checks. Bind scripts/sites to the same environment ID and loopback endpoint; missing bridge state means start that runner first.
- Read that environment's `.sst/local/<id>/outputs.json` and private logs. Local state includes credentials. Specify log redirection explicitly; a log-directory variable does not redirect stdout.
- Build `packages/sst` before tests, which import `dist`. Run regressions for changed paths; synthesis or Docker health alone does not prove application behavior. Use the verification network guard when testing local-only Node traffic, while recognizing that it is not a Docker/OS firewall.
- SDK v2 needs explicit endpoints. Docker and host endpoints differ; preserve service-specific routing. Downstream applications should use an approved packaged SST build with compatible CDK identities, not arbitrary cross-checkout symlinks or version changes.
- Keep emulator SQL compatibility in SST's Data API bridge. Do not edit downstream historical migrations or business logic to hide emulator bugs. Preserve invocation/database credential separation and upstream errors.

## Stop and report

Stop only this task's processes and Docker project. Ask before deleting data or interrupting user-owned sessions. Confirm lock ownership before recovery; do not globally prune Docker. SST restarts preserve data while Docker remains up. Snapshots are disabled, so Docker restarts need a fresh local environment as documented.

Host Node handlers reload and support breakpoints. Job/infrastructure edits need SST restart. Jobs run in CodeBuild containers and cannot be cancelled locally. Schedules and inbound email are exercised manually. Unsupported services fail explicitly; local checks do not establish AWS parity.

Report the checkout/build, ID/stage, region, Compose project, ports, processes, private log paths and checks actually run. State missing prerequisites and unverified runner/platform behavior. Starting an environment does not authorize CI configuration changes or publishing.

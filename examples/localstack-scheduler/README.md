# Scheduler resource support

This example exercises the additional SST resources used by Bluestone Scheduler.
It uses synthetic handlers and data; it does not contact Scheduler's external
integrations. Infrastructure runs in LocalStack Docker, Lambda handlers run in
the checkout, and long-running Jobs use LocalStack CodeBuild containers.

## Run

Use Node 22, Docker and the same LocalStack Ultimate entitlement as the
[base example](../localstack/README.md). Build SST from the repository root:

```sh
pnpm --dir packages/sst build
cd examples/localstack-scheduler
pnpm install --ignore-workspace
```

The example links SST and its CDK dependencies to the same checkout. Mixing
separate CDK installations with a symlinked SST can cause construct identity
errors even when their version numbers match.

Set `LOCALSTACK_AUTH_TOKEN` in your shell, then start an isolated Docker project:

```sh
export COMPOSE_PROJECT_NAME=sst-scheduler-test
export LOCALSTACK_PORT=4569
export LOCALSTACK_DATA_DIR="$(mktemp -d -t sst-scheduler-data)"
docker compose -f ../localstack/compose.yaml -f compose.yaml up -d --wait

pnpm exec sst secrets load secrets.example.env \
  --local --env scheduler --endpoint http://127.0.0.1:4569

pnpm exec sst local --env scheduler \
  --endpoint http://127.0.0.1:4569 --port 13561
```

CodeBuild requires the bind mount in the Compose overlay. Keep the same data
directory while this Docker project is running. Snapshot persistence remains
disabled: restarting Docker requires redeployment into a fresh environment.
No Cloud Pods or remote LocalStack environments are used. Initial image pulls
and license activation require network access.

Wait for `Local ready`, then in another terminal:

```sh
cd examples/localstack-scheduler
node smoke.mjs
cd site
node ../../../packages/sst/dist/cli/sst.js bind \
  --local --env scheduler --endpoint http://127.0.0.1:4569 node check.mjs
```

The smoke check exercises HTTP authorization/CORS, DynamoDB conditional writes
and indexes, FIFO delivery and dead-lettering, SNS fanout, CodeBuild execution,
explicit schedule invocation, S3-based inbound email injection, and captured SES
mail. The site check verifies the same binding path used by a Next.js dev server.
It checks TTL configuration, not the timing of DynamoDB's background TTL deletion.

Stop SST with Ctrl+C. To stop this example's Docker project:

```sh
docker compose -f ../localstack/compose.yaml -f compose.yaml down
```

## Integrating Scheduler

This PR supplies SST infrastructure support. Scheduler still needs application
configuration for its local URLs, test credentials and third-party substitutes.
Do not run its existing `pnpm dev` script expecting LocalStack: that remains
the AWS-backed `sst dev` workflow.

1. Link this fork's built `packages/sst/dist`. Share its `aws-cdk-lib` and
   `constructs` installations when using symlinks, as this example does.
2. Use `sst local --env scheduler --endpoint ... --port ...` for infrastructure.
   The stage is `local-scheduler`; Scheduler already treats that as a dev stage.
3. Configure application API URLs from `api.url`/`api.customDomainUrl`. In local
   mode those point to LocalStack, while the API domain construct remains
   available for Scheduler's TLS-policy customization. SST skips public DNS
   lookups and records locally. Application strings computed independently by
   `getApiBaseDomain()` still need local replacements, including OAuth callback
   URLs, CORS origins and frontend environment variables.
4. Load **local test values only** with `sst secrets load <file> --local --env
   scheduler --endpoint ...`. No AWS secret replication is performed. Missing
   secret values fail normally rather than silently using production values.
5. Run each Next.js dev server from its site directory with `sst bind --local
   --env scheduler --endpoint ... next dev`. Plain scripts can use the same
   command. Restart the bound process after changing secrets or infrastructure.
6. Keep Sentry disabled and point external clients to application-owned local
   substitutes. This SST change does not simulate Elation, Tenovi, Google Drive,
   Snowflake or Google OAuth. Do not use real webhook-registration scripts or
   production credentials for the local substitutes.
7. For schedules, invoke the corresponding Lambda explicitly. All SST
   `Schedule` resources are disabled locally, regardless of their cloud setting.
   For inbound email, put a synthetic `.eml` object into the intake bucket's
   configured prefix, then exercise the existing S3 notifications and consumers.

### Execution differences

- Live Node Lambdas retain host breakpoints and source watching.
- `Script` handlers with live development disabled are packaged and executed
  by LocalStack Lambda, including deployment callbacks.
- Jobs use the existing CodeBuild deployment path, with their configured
  runtime and timeout, rather than SST's ten-second live-dev Lambda wrapper.
  Re-run `sst local` after changing Job code; host Lambda breakpoints do not
  apply to CodeBuild containers.
  LocalStack returns HTTP 501 for `StopBuild`: **Job cancellation is currently
  unavailable**. Scheduler has no `Job.cancel` callers. The smoke check records
  this limitation explicitly; it does not report cancellation as successful.
- Next.js runs as a local dev server; this does not deploy CloudFront websites.
- Receipt rules can be provisioned, but receiving real mail and automatic
  Scheduler execution are not supplied by the pinned LocalStack image.
  Use real SST dev stages for those integration checks.

### Evidence

Scheduler commit `aec2a0fb` synthesized successfully from an isolated source
copy with nonlocal Node requests blocked. Its complete dev graph passed local
resource validation: 96 API routes, 213 Lambda resources, 22 queues, 10 DynamoDB
tables, eight schedules, and the database/site/supporting resources. This is
synthesis evidence, not proof that all Scheduler business flows work locally.

The expanded fixture deployment, smoke check, and local site-binding check passed
on the pinned image with Node 22.23.0 and OrbStack. SST build and all 1,034 tests
(39 files) passed. No real AWS deployment or full Scheduler business-flow test
was performed. On the first cold CodeBuild image start, LocalStack logged a
build-monitor race even though the handler completed; the smoke check verifies
the handler's database result directly.

LocalStack documentation: [API Gateway](https://docs.localstack.cloud/aws/services/apigateway/),
[CodeBuild](https://docs.localstack.cloud/aws/services/codebuild/),
[Scheduler limitations](https://docs.localstack.cloud/aws/services/scheduler/#current-limitations),
[SES limitations](https://docs.localstack.cloud/aws/services/ses/#current-limitations).

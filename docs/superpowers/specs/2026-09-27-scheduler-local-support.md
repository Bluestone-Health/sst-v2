# Scheduler local support — proposed scope

Status: user approved local substitutes and explicit triggers; implementation and verification in progress.

## Outcome

Add reusable SST local support needed by Bluestone Scheduler in a PR based on
`codex/localstack-lambda-bridge` (PR #19), targeting that branch rather than
`main-bsh`. Keep infrastructure and application data on the user's machine and
Docker. Retain the existing snapshot-disabled policy and normal AWS behavior.

## Observed gaps

Inspected Scheduler's `sst.config.ts`, stack definitions, database service,
stage helpers, deployment scripts, and Sentry build helper.

| Area | Required work / evidence |
| --- | --- |
| HTTP API | API Gateway v2 routes, integrations, Lambda authorizers, CORS; expose local URLs in outputs and bindings. Scheduler explicitly requires a custom-domain construct and also computes public URLs itself. |
| DynamoDB | Tables, indexes, TTL and conditional writes used by caches, deduplication and locks. Verify behavior, not just template acceptance. |
| Messaging | FIFO queues, DLQs, SNS subscriptions and relevant cross-stack event-source references. Reuse LocalStack delivery and the existing bridge. |
| Database and encryption | Existing RDSv2/Data API path plus KMS keys/aliases, managed IAM policies and network ACL support resources. Preserve Scheduler's MainDbClusterEnc binding. |
| Schedules | Scheduler uses AWS::Scheduler::Schedule, with most schedules disabled in dev. LocalStack currently documents execution as mocked. Trigger policy needs a decision. |
| Email | SES sending can be inspected locally without SMTP forwarding. Receipt rules are mocked; inbound email needs a chosen local entry point. |
| Jobs | Claims ingestion uses an hours-long SST Job. Existing live-dev Job creates a ten-second Lambda, so accepting CodeBuild resources alone is insufficient. Verify run, failure, timeout and cancellation semantics before choosing the smallest implementation. |
| Sites and scripts | Reuse Next.js dev servers. Add local binding/secret support without IoT or cloud metadata paths; preserve endpoint and credential isolation in child processes. |
| CDK helpers | Inventory synthesized custom resources, log retention and bucket notification helpers; route their clients locally and exercise callbacks. |

## Approach

Extend existing constructs and CLI paths only where local behavior differs.
Use LocalStack service implementations instead of adding service emulators or
a provider framework. Keep an explicit verified resource allowlist; do not
remove validation or silently skip resources to make synthesis pass.

Add a compact integration example exercising the missing resource contracts.
Verify API authorization/CORS, DynamoDB condition failures, FIFO ordering and
retry, SNS fanout, local secrets, site bindings, job lifecycle and chosen
schedule/email trigger behavior against the pinned Docker image. Retain the
existing RDS/S3/SQS checks and AWS synthesis regressions.

## Scheduler-side requirements

The SST PR cannot replace application-specific public URLs, OAuth behavior,
third-party clients or test data. Scheduler needs local endpoint configuration
and an explicit external-integration policy. Its create/update scripts contain
third-party webhook mutations, although their current non-production guard
normally skips them outside the `dev` command. Do not execute them against real
services while verifying local support.

The Sentry build plugin already disables uploads outside production; runtime
Sentry configuration still needs local treatment. Scheduler's stage helpers
already classify `local-*` as dev. No production stage is needed.

Decisions approved by Allen: use local substitutes and explicit schedule/email
triggers; use real SST dev stages for external integrations and inbound behavior.
Schedules remain disabled locally. Inject email as an S3 object to exercise the
existing downstream notification path. Capture outgoing SES messages locally.

Implementation sequence: extend resource validation and API URLs; route local
secrets and bound site commands; reuse CodeBuild for Jobs and packaged Node
Lambdas for Scripts; verify the fixture and full Scheduler synthesis; document
application integration requirements and open the stacked PR.

Full Scheduler synthesis at `aec2a0fb` passed in an isolated source copy with
nonlocal Node network requests blocked: 96 HTTP routes, 213 Lambda resources,
22 queues, 10 tables, eight schedules. Resource validation passed. This is
synthesis evidence, not an end-to-end Scheduler application deployment.

## Documentation consulted

- [API Gateway](https://docs.localstack.cloud/aws/services/apigateway/)
- [SQS](https://docs.localstack.cloud/aws/services/sqs/)
- [Scheduler limitations](https://docs.localstack.cloud/aws/services/scheduler/#current-limitations): schedule execution and target triggering are mocked.
- [SES limitations](https://docs.localstack.cloud/aws/services/ses/#current-limitations): receiving email is unavailable and receipt rules are mocked.
- [CodeBuild](https://docs.localstack.cloud/aws/services/codebuild/): S3/NO_SOURCE support exists, but the actual SST build and runtime path still require testing.

## Verification observations

- Build and all 1,034 tests across 39 files passed under Node 22.
- The expanded synthetic graph deployed locally, including packaged Script
  execution and supporting KMS, network ACL, IAM and log resources.
- HTTP authorization/CORS, conditional DynamoDB writes, FIFO/DLQ, SNS, local
  site bindings, CodeBuild handler execution, manual schedule invocation,
  S3 inbound-email events and captured SES delivery were exercised.
- CodeBuild requires a host bind mount. The first cold image startup also
  emitted a LocalStack build-monitor race, despite successful handler execution.
- StopBuild returns HTTP 501. Scheduler has no Job.cancel callers. User decision
  on retaining this limitation versus implementing a separate runner is pending.

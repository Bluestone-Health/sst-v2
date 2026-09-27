# SST v2

<a href="https://sst.dev/discord"><img alt="Discord" src="https://img.shields.io/discord/983865673656705025?style=flat-square&label=Discord" /></a>
<a href="https://www.npmjs.com/package/sst"><img alt="npm" src="https://img.shields.io/npm/v/sst.svg?style=flat-square" /></a>
<a href="https://github.com/sst/v2/actions/workflows/test.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/sst/v2/test.yml?style=flat-square&branch=master" /></a>

Repo for SST v2. [View docs](https://v2.sst.dev).

For the latest version of SST, head over to [sst.dev](https://sst.dev) instead.

## Local development with Docker

This fork includes experimental, opt-in `sst local` for Node.js handlers with LocalStack S3, SQS, and PostgreSQL/Data API. See the [local example walkthrough](examples/localstack/README.md) for setup and verification. Requires Node 22, Docker, and a LocalStack RDS/Data API entitlement; no AWS credentials are needed. LocalStack snapshots are disabled, so Docker restarts require a reset.

See the [Scheduler resource example](examples/localstack-scheduler/README.md) for local HTTP APIs, DynamoDB, FIFO queues, SNS, Jobs, site bindings, and explicit schedule/email triggers.

Join our community [Discord](https://sst.dev/discord) | [YouTube](https://www.youtube.com/c/sst-dev) | [Twitter](https://twitter.com/SST_dev) | [Contribute](CONTRIBUTING.md)

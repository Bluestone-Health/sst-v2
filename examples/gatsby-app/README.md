# How to create a Gatsby.js app

An example full-stack serverless Gatsby.js app created with SST.

## Getting Started

[**Read the tutorial**](https://sst.dev/examples/how-to-create-a-gatsbyjs-app-with-serverless.html)

Install the example.

```bash
$ npx create-sst@two --template=examples/gatsby-app
# Or with Yarn
$ yarn create sst@two --template=examples/gatsby-app
# Or with PNPM
$ pnpm create sst@two --template=examples/gatsby-app
```

## Commands

### `npm run dev`

Starts the local Lambda development environment.

### `npm run build`

Build your app and synthesize your stacks.

Generates a `.build/` directory with the compiled files and a `.build/cdk.out/` directory with the synthesized CloudFormation stacks.

### `npm run deploy [stack]`

Deploy all your stacks to AWS. Or optionally deploy, a specific stack.

### `npm run remove [stack]`

Remove all your stacks and all of their resources from AWS. Or optionally removes, a specific stack.

## Documentation

Learn more about SST.

- [Docs](https://docs.sst.dev)
- [sst](https://docs.sst.dev/packages/sst)

## Community

[Follow us on Twitter](https://twitter.com/sst_dev) or [post on our forums](https://discourse.sst.dev).

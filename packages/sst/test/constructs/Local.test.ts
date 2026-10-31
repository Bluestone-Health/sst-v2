import { expect, test } from "vitest";
import { Template, Match } from "aws-cdk-lib/assertions";
import { createApp } from "./helper.js";
import {
  Api,
  Function,
  WebSocketApi,
  Job,
  Schedule,
  Script,
  Stack,
} from "../../dist/constructs/index.js";
import * as apig from "aws-cdk-lib/aws-apigatewayv2";
import type { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { configureLocal } from "../../dist/local.js";

test("local constructs retain API domains without DNS lookups, package Scripts, disable schedules, and use CodeBuild Jobs", async () => {
  configureLocal({
    id: "scheduler",
    endpoint: "http://127.0.0.1:4569",
    port: 13561,
    token: "local-test-token-with-more-than-32-characters",
  });
  const stack = new Stack(await createApp({ mode: "dev" }), "stack");
  const api = new Api(stack, "Api", {
    customDomain: "api.example.test",
    routes: { "GET /": "test/lambda.handler" },
  });
  new Script(stack, "Script", { onCreate: "test/lambda.handler" });
  new Schedule(stack, "Tick", {
    schedule: "rate(1 minute)",
    enabled: true,
    job: { function: "test/lambda.handler" },
  });
  new Job(stack, "Ingest", {
    handler: "test/lambda.handler",
    timeout: "1 hour",
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::Route53::RecordSet", 0);
  template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 1);
  template.hasResourceProperties("AWS::Scheduler::Schedule", {
    State: "DISABLED",
  });
  template.hasResourceProperties("AWS::Lambda::Function", {
    Environment: {
      Variables: Match.objectLike({
        SST_JOB_PROVIDER: "codebuild",
        AWS_ENDPOINT_URL: "http://host.docker.internal:4569",
      }),
    },
  });
  template.hasResourceProperties("AWS::CodeBuild::Project", {
    TimeoutInMinutes: 60,
  });
  expect(api.url).toContain(".execute-api.localhost.localstack.cloud:4569");
  expect(api.customDomainUrl).toBe(api.url);
});

test("packaged local Functions give S3 SDK virtual-host requests a container endpoint", async () => {
  configureLocal({
    id: "function",
    endpoint: "http://127.0.0.1:4569",
    port: 13561,
  });
  const stack = new Stack(await createApp({ mode: "dev" }), "stack");
  const fn = new Function(stack, "Packaged", {
    handler: "test/lambda.handler",
    enableLiveDev: false,
  });
  const id = stack.getLogicalId(fn.node.defaultChild as CfnFunction);
  const env =
    Template.fromStack(stack).toJSON().Resources[id].Properties.Environment
      .Variables;
  expect(env.AWS_ENDPOINT_URL).toBe("http://host.docker.internal:4569");
  expect(env.AWS_ENDPOINT_URL_S3).toBe(
    "http://s3.localhost.localstack.cloud:4566"
  );
  const previous = { ...process.env };
  let request: any;
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: {
      handle: async (input: any) => {
        request = input;
        return {
          response: { statusCode: 200, headers: {}, body: new Uint8Array() },
        };
      },
    },
  });
  try {
    Object.assign(process.env, {
      AWS_ENDPOINT_URL: env.AWS_ENDPOINT_URL,
      AWS_ENDPOINT_URL_S3: env.AWS_ENDPOINT_URL_S3,
    });
    await client.send(
      new PutObjectCommand({
        Bucket: "local-bucket",
        Key: "check.txt",
        Body: "ok",
      })
    );
    expect(request.hostname).toBe("local-bucket.s3.localhost.localstack.cloud");
    expect(request.port).toBe(4566);
    expect(request.path).toBe("/check.txt");
  } finally {
    process.env = previous;
    client.destroy();
  }
});

test.each([false, true])(
  "local WebSocket APIs reject CDK supplied API/stage (imported=%s)",
  async (imported) => {
    configureLocal({
      id: "websocket",
      endpoint: "http://127.0.0.1:4569",
      port: 13561,
    });
    const stack = new Stack(await createApp({ mode: "dev" }), "stack");
    const api = imported
      ? apig.WebSocketApi.fromWebSocketApiAttributes(stack, "Existing", {
          webSocketId: "existing",
        })
      : new apig.WebSocketApi(stack, "Existing");
    const stage = imported
      ? apig.WebSocketStage.fromWebSocketStageAttributes(
          stack,
          "ExistingStage",
          { api, stageName: "test" }
        )
      : new apig.WebSocketStage(stack, "ExistingStage", {
          webSocketApi: api,
          stageName: "test",
        });
    expect(
      () =>
        new WebSocketApi(stack, "Socket", {
          cdk: { webSocketApi: api, webSocketStage: stage },
        })
    ).toThrow(/Local mode does not support.*WebSocket/);
  }
);

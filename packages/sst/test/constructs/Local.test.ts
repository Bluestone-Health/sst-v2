import { expect, test } from "vitest";
import { Template, Match } from "aws-cdk-lib/assertions";
import { createApp } from "./helper.js";
import {
  Api,
  Job,
  Schedule,
  Script,
  Stack,
} from "../../dist/constructs/index.js";
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

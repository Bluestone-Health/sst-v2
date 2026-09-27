import { expect, test } from "vitest";
import { validateLocalAssembly } from "../dist/local-resources.js";
import { configureLocal, localEnvironment } from "../dist/local.js";

test("FIFO event sources resolve across stacks, without accepting arbitrary imported ARNs", () => {
  const storage = {
    stackName: "Storage",
    template: {
      Resources: {
        Queue: { Type: "AWS::SQS::Queue", Properties: { FifoQueue: true } },
      },
      Outputs: {
        QueueArn: {
          Export: { Name: "Work" },
          Value: { "Fn::GetAtt": ["Queue", "Arn"] },
        },
      },
    },
  };
  const consumer = {
    stackName: "Consumer",
    template: {
      Resources: {
        Mapping: {
          Type: "AWS::Lambda::EventSourceMapping",
          Properties: { EventSourceArn: { "Fn::ImportValue": "Work" } },
        },
      },
    },
  };
  expect(() => validateLocalAssembly([storage, consumer])).not.toThrow();
  expect(() => validateLocalAssembly([consumer])).toThrow(/SQS event source/);
  expect(() =>
    validateLocalAssembly([
      {
        stackName: "Unsupported",
        template: { Resources: { Cluster: { Type: "AWS::ECS::Cluster" } } },
      },
    ])
  ).toThrow(/ECS/);
});

test("host bindings discard credential and endpoint overrides", () => {
  configureLocal({
    id: "scheduler",
    endpoint: "http://127.0.0.1:4569",
    port: 13561,
  });
  const env = localEnvironment({
    AWS_PROFILE: "production",
    AWS_ROLE_ARN: "cloud-role",
    AWS_ACCESS_KEY_ID: "real",
    AWS_ENDPOINT_URL_DYNAMODB: "https://dynamodb.us-east-1.amazonaws.com",
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    SST_LOCAL_BRIDGE_TOKEN: "secret",
    SST_Queue_queueUrl_Work:
      "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/work.fifo",
  });
  expect(env.AWS_PROFILE).toBeUndefined();
  expect(env.AWS_ROLE_ARN).toBeUndefined();
  expect(env.SST_LOCAL_BRIDGE_TOKEN).toBeUndefined();
  expect(env.AWS_ENDPOINT_URL_DYNAMODB).toBeUndefined();
  expect(env.AWS_ACCESS_KEY_ID).toBe("test");
  expect(env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS).toBe("false");
  expect(env.SST_Queue_queueUrl_Work).toBe(
    "http://127.0.0.1:4569/000000000000/work.fifo"
  );
});

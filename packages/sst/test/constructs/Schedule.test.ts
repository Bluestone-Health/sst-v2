import { test, expect } from "vitest";
import { ANY, countResources, createApp, hasResource } from "./helper";
import {
  Stack,
  Schedule,
  ScheduleProps,
  Function,
  Bucket,
} from "../../dist/constructs";

const lambdaDefaultPolicy = {
  Action: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
  Effect: "Allow",
  Resource: "*",
};

///////////////////
// Test Constructor
///////////////////

test("constructor: basic schedule", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  countResources(stack, "AWS::Lambda::Function", 1);
  hasResource(stack, "AWS::Lambda::Function", {
    Handler: "index.placeholder",
  });
  countResources(stack, "AWS::Scheduler::Schedule", 1);
  hasResource(stack, "AWS::Scheduler::Schedule", {
    State: "ENABLED",
    ScheduleExpression: "rate(5 minutes)",
    FlexibleTimeWindow: {
      Mode: "OFF",
    },
  });
});

test("schedule is rate", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(1 hour)",
    job: {
      function: "test/lambda.handler",
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    ScheduleExpression: "rate(1 hour)",
  });
});

test("schedule is cron", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "cron(15 10 * * ? *)",
    job: {
      function: "test/lambda.handler",
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(15 10 * * ? *)",
  });
});

test("schedule is undefined", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(() => {
    // @ts-ignore Allow undefined "schedule"
    new Schedule(stack, "Schedule", {
      job: {
        function: "test/lambda.handler",
      },
    } as ScheduleProps);
  }).toThrow(/Missing "schedule"/);
});

test("enabled is undefined", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    State: "ENABLED",
  });
});

test("enabled is true", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
    enabled: true,
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    State: "ENABLED",
  });
});

test("enabled is false", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
    enabled: false,
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    State: "DISABLED",
  });
});

test("description is set", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
    description: "My scheduled job",
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    Description: "My scheduled job",
  });
});

test("timezone is set", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "cron(0 9 * * ? *)",
    job: {
      function: "test/lambda.handler",
    },
    timezone: "America/New_York",
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    ScheduleExpressionTimezone: "America/New_York",
  });
});

test("timezone is undefined", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    ScheduleExpression: "rate(5 minutes)",
    // ScheduleExpressionTimezone should be undefined/not set
  });
});

test("retryPolicy is set", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
    retryPolicy: {
      maximumRetryAttempts: 3,
      maximumEventAgeInSeconds: 3600,
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    Target: {
      Arn: ANY,
      RoleArn: ANY,
      RetryPolicy: {
        MaximumRetryAttempts: 3,
        MaximumEventAgeInSeconds: 3600,
      },
    },
  });
});

test("job is string", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  countResources(stack, "AWS::Lambda::Function", 1);
  hasResource(stack, "AWS::Lambda::Function", {
    Handler: "index.placeholder",
  });
});

test("job is Function", async () => {
  const stack = new Stack(await createApp(), "stack");
  const fn = new Function(stack, "Function", {
    handler: "test/lambda.handler",
  });
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: fn,
    },
  });
  countResources(stack, "AWS::Lambda::Function", 1);
  hasResource(stack, "AWS::Lambda::Function", {
    Handler: "index.placeholder",
  });
});

test("job with cdk.target override", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
      cdk: {
        target: {
          input: '{"key": "value"}',
        },
      },
    },
  });
  hasResource(stack, "AWS::Scheduler::Schedule", {
    Target: {
      Arn: ANY,
      RoleArn: ANY,
      Input: '{"key": "value"}',
    },
  });
});

test("IAM role for scheduler invocation", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  countResources(stack, "AWS::IAM::Role", 2); // Lambda execution role + Scheduler invoke role
  hasResource(stack, "AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "scheduler.amazonaws.com",
          },
        },
      ],
      Version: "2012-10-17",
    },
  });
});

test("IAM policy for Lambda invocation", async () => {
  const stack = new Stack(await createApp(), "stack");
  new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  hasResource(stack, "AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        {
          Action: "lambda:InvokeFunction",
          Effect: "Allow",
          Resource: ANY,
        },
      ],
      Version: "2012-10-17",
    },
  });
});

test("cdk.id override", async () => {
  const stack = new Stack(await createApp(), "stack");
  const schedule = new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
    cdk: {
      id: "CustomScheduleId",
    },
  });
  expect(schedule.node.id).toBe("CustomScheduleId");
});

///////////////////
// Test Methods
///////////////////

test("attachPermissions", async () => {
  const stack = new Stack(await createApp(), "stack");
  const schedule = new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  schedule.attachPermissions(["s3"]);
  hasResource(stack, "AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        lambdaDefaultPolicy,
        { Action: "s3:*", Effect: "Allow", Resource: "*" },
      ],
      Version: "2012-10-17",
    },
  });
});

test("bind", async () => {
  const stack = new Stack(await createApp(), "stack");
  const bucket = new Bucket(stack, "bucket");
  const schedule = new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  schedule.bind([bucket]);
  hasResource(stack, "AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: [
        lambdaDefaultPolicy,
        { Action: "s3:*", Effect: "Allow", Resource: ANY },
      ],
      Version: "2012-10-17",
    },
  });
});

test("getConstructMetadata", async () => {
  const stack = new Stack(await createApp(), "stack");
  const schedule = new Schedule(stack, "Schedule", {
    schedule: "rate(5 minutes)",
    job: {
      function: "test/lambda.handler",
    },
  });
  const metadata = schedule.getConstructMetadata();
  expect(metadata.type).toBe("Schedule");
  expect(metadata.data.schedule).toBe("rate(5 minutes)");
  expect(metadata.data.job).toBeDefined();
  expect(metadata.data.scheduleResourceName).toBeDefined();
});

import {
  Api,
  Bucket,
  Config,
  Function,
  Job,
  NextjsSite,
  Queue,
  Schedule,
  Script,
  Table,
  Topic,
  use,
} from "sst/constructs";
import type { SSTConfig } from "sst";
import { EventType } from "aws-cdk-lib/aws-s3";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { Duration } from "aws-cdk-lib";
import {
  Vpc,
  NetworkAcl,
  AclCidr,
  AclTraffic,
  TrafficDirection,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import { ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, LogStream } from "aws-cdk-lib/aws-logs";
import { Key } from "aws-cdk-lib/aws-kms";
import { CfnReceiptRuleSet, CfnReceiptRule } from "aws-cdk-lib/aws-ses";

export default {
  config() {
    return { name: "local-scheduler", region: "us-east-1" };
  },
  stacks(app) {
    app.setDefaultFunctionProps({ runtime: "nodejs22.x", timeout: 30 });
    function Storage({ stack }) {
      const vpc = new Vpc(stack, "Network", {
        maxAzs: 1,
        natGateways: 0,
        subnetConfiguration: [
          { name: "Isolated", subnetType: SubnetType.PRIVATE_ISOLATED },
        ],
      });
      const acl = new NetworkAcl(stack, "Acl", {
        vpc,
        subnetSelection: { subnetType: SubnetType.PRIVATE_ISOLATED },
      });
      acl.addEntry("Internal", {
        cidr: AclCidr.ipv4("10.0.0.0/16"),
        traffic: AclTraffic.allTraffic(),
        direction: TrafficDirection.INGRESS,
        ruleNumber: 100,
      });
      new ManagedPolicy(stack, "Policy", {
        statements: [
          new PolicyStatement({
            actions: ["logs:CreateLogStream"],
            resources: ["*"],
          }),
        ],
      });
      new LogStream(stack, "Stream", { logGroup: new LogGroup(stack, "Logs") });
      const key = new Key(stack, "Key", { alias: `${app.stage}-scheduler` });
      const files = new Bucket(stack, "Files", {
        cdk: { bucket: { encryptionKey: key } },
      });
      const table = new Table(stack, "Records", {
        fields: { id: "string", category: "string" },
        primaryIndex: { partitionKey: "id" },
        globalIndexes: { byCategory: { partitionKey: "category" } },
        timeToLiveAttribute: "expires",
      });
      const inbound = new Function(stack, "Inbound", {
        handler: "src/handlers.inbound",
        bind: [table],
      });
      files.cdk.bucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(inbound),
        { prefix: "email/" }
      );
      new Script(stack, "Initialize", {
        onCreate: "src/handlers.initialize",
        defaults: { function: { bind: [table] } },
      });
      const secret = new Config.Secret(stack, "LOCAL_TEST_SECRET");
      const dlq = new Queue(stack, "DeadLetters", {
        cdk: { queue: { fifo: true } },
      });
      const queue = new Queue(stack, "Work", {
        cdk: {
          queue: {
            fifo: true,
            contentBasedDeduplication: true,
            visibilityTimeout: Duration.seconds(35),
            deadLetterQueue: { queue: dlq.cdk.queue, maxReceiveCount: 2 },
          },
        },
      });
      return { key, files, table, secret, queue, dlq };
    }
    app.stack(Storage);
    app.stack(function Application({ stack }) {
      const { table, files, secret, queue, dlq } = use(Storage);
      queue.addConsumer(stack, {
        function: { handler: "src/handlers.consume", bind: [table] },
        cdk: { eventSource: { batchSize: 1, reportBatchItemFailures: true } },
      });
      const topic = new Topic(stack, "Events", {
        subscribers: {
          record: { handler: "src/handlers.consume", bind: [table] },
        },
      });
      const job = new Job(stack, "Ingest", {
        runtime: "nodejs22.x",
        handler: "src/handlers.job",
        bind: [table],
        timeout: "1 hour",
      });
      const api = new Api(stack, "Api", {
        customDomain: "scheduler.example.test",
        cors: {
          allowOrigins: ["http://localhost:3000"],
          allowHeaders: ["authorization", "content-type"],
        },
        authorizers: {
          local: {
            type: "lambda",
            function: new Function(stack, "Authorizer", {
              handler: "src/handlers.authorize",
            }),
            responseTypes: ["simple"],
          },
        },
        defaults: {
          authorizer: "local",
          function: { bind: [table, files, secret, queue, topic, job] },
        },
        routes: {
          "POST /exercise": "src/handlers.api",
        },
      });
      const schedule = new Schedule(stack, "Tick", {
        schedule: "rate(1 minute)",
        job: { function: { handler: "src/handlers.tick", bind: [table] } },
      });
      const receiptRules = new CfnReceiptRuleSet(stack, "ReceiptRules", {
        ruleSetName: `${app.stage}-inbound`,
      });
      new CfnReceiptRule(stack, "ReceiptRule", {
        ruleSetName: receiptRules.ref,
        rule: {
          name: "local-inbound",
          enabled: true,
          recipients: ["inbound@example.test"],
          actions: [
            {
              s3Action: {
                bucketName: files.bucketName,
                objectKeyPrefix: "email/",
              },
            },
          ],
        },
      });
      new NextjsSite(stack, "Portal", {
        path: "site",
        bind: [table, secret],
        environment: { API_URL: api.url },
      });
      stack.addOutputs({
        ApiUrl: api.url,
        QueueUrl: queue.queueUrl,
        DeadLetterUrl: dlq.queueUrl,
        TableName: table.tableName,
        TopicArn: topic.topicArn,
        BucketName: files.bucketName,
        TickFunction: schedule.jobFunction.functionName,
        JobManager: job._jobManager.functionName,
      });
    });
  },
} satisfies SSTConfig;

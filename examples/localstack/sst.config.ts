import { Bucket, Function, Queue, RDSv2 } from "sst/constructs";
import type { SSTConfig } from "sst";
import { Duration } from "aws-cdk-lib";

export default {
  config() {
    return { name: "localstack-example", region: "us-east-1" };
  },
  stacks(app) {
    app.setDefaultFunctionProps({
      runtime: "nodejs22.x",
      timeout: 10,
      environment: { MARKER: process.env.MARKER || "local" },
    });
    app.stack(function Example({ stack }) {
      const database = new RDSv2(stack, "Database", {
        engine: "postgresql17.7",
        defaultDatabaseName: "example",
        migrations: "migrations",
      });
      const work = new Queue(stack, "Work", {
        cdk: { queue: { visibilityTimeout: Duration.seconds(15) } },
      });
      const files = new Bucket(stack, "Files", {
        cors: true,
        notifications: {
          created: { type: "queue", queue: work, events: ["object_created"] },
        },
      });
      work.addConsumer(stack, {
        function: { handler: "src/consumer.main", bind: [database, files] },
        cdk: { eventSource: { batchSize: 5, reportBatchItemFailures: true } },
      });
      const api = new Function(stack, "Entry", {
        handler: "src/api.main",
        bind: [files, work, database],
      });
      stack.addOutputs({
        EntryFunction: api.functionName,
        QueueUrl: work.queueUrl,
        BucketName: files.bucketName,
        ClusterArn: database.clusterArn,
        SecretArn: database.secretArn,
      });
    });
  },
} satisfies SSTConfig;

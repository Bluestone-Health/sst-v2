import AWS from "aws-sdk";
import { Table } from "sst/node/table";
import { Queue } from "sst/node/queue";
import { Topic } from "sst/node/topic";
import { Config } from "sst/node/config";
import { Job } from "sst/node/job";

// SDK v2 needs an explicit endpoint; the application would use its existing SDK clients.
const options = {
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_REGION,
};
const db = new AWS.DynamoDB.DocumentClient(options);
const put = (id: string, extra = {}) =>
  db
    .put({
      TableName: Table.Records.tableName,
      Item: { id, category: "local", ...extra },
    })
    .promise();

export async function authorize(event) {
  return {
    isAuthorized: event.headers?.authorization === "local-test",
    context: { user: "local" },
  };
}
export async function api(event) {
  const { id, delay = 0 } = JSON.parse(event.body);
  await db
    .put({
      TableName: Table.Records.tableName,
      Item: { id, category: "local" },
      ConditionExpression: "attribute_not_exists(id)",
    })
    .promise();
  const sqs = new AWS.SQS(options);
  for (const n of [1, 2])
    await sqs
      .sendMessage({
        QueueUrl: Queue.Work.queueUrl,
        MessageBody: JSON.stringify({ id: `${id}-fifo-${n}` }),
        MessageGroupId: id,
      })
      .promise();
  await new AWS.SNS(options)
    .publish({
      TopicArn: Topic.Events.topicArn,
      Message: JSON.stringify({ id: `${id}-sns` }),
    })
    .promise();
  const job = await Job.Ingest.run({ payload: { id: `${id}-job`, delay } });
  return {
    statusCode: 200,
    body: JSON.stringify({ secret: Config.LOCAL_TEST_SECRET, ...job }),
  };
}
export async function consume(event) {
  for (const record of event.Records) {
    const item = JSON.parse(record.body || record.Sns.Message);
    if (item.fail) throw new Error("Intentional redelivery probe");
    if (item.id.endsWith("-fifo-2")) {
      const previous = await db
        .get({
          TableName: Table.Records.tableName,
          Key: { id: item.id.replace(/2$/, "1") },
          ConsistentRead: true,
        })
        .promise();
      if (!previous.Item) throw new Error("FIFO order was not preserved");
    }
    await put(item.id);
  }
  return { batchItemFailures: [] };
}
export async function job(event) {
  await new Promise((resolve) => setTimeout(resolve, event.delay || 0));
  await put(event.id);
}
export async function tick(event) {
  await put(event.id);
}
export async function inbound(event) {
  for (const record of event.Records)
    await put(`email-${record.s3.object.key}`);
}

export async function initialize() {
  await put("script-created");
}

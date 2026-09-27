import "../network-guard.cjs";
import AWS from "aws-sdk";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Bucket } from "sst/node/bucket";
import { Queue } from "sst/node/queue";
import { randomUUID } from "node:crypto";
import { client, db, target } from "./database";
import { version } from "./version";

// SDK v2 needs explicit endpoint configuration; SDK v3 reads AWS_ENDPOINT_URL.
const s3 = new AWS.S3({
  endpoint: process.env.AWS_ENDPOINT_URL,
  s3ForcePathStyle: true,
});
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
export async function main(event, context) {
  const marker = process.env.MARKER!;
  console.log({ marker, request: context.awsRequestId, action: event.action });
  if (event.action === "error") throw new Error(`intentional error ${marker}`);
  if (event.action === "timeout") while (true) {}
  if (event.action === "upload") {
    const key = `${marker}-${randomUUID()}.txt`;
    const params = { Bucket: Bucket.Files.bucketName, Key: key, Expires: 300 };
    return {
      key,
      marker,
      upload: await s3.getSignedUrlPromise("putObject", params),
      download: await s3.getSignedUrlPromise("getObject", params),
    };
  }
  if (event.action === "queue") {
    const id = randomUUID();
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: Queue.Work.queueUrl,
        MessageBody: JSON.stringify({
          id,
          marker,
          failOnce: !!event.failOnce,
          crashOnce: !!event.crashOnce,
        }),
      })
    );
    return { id, marker };
  }
  if (event.action === "transactions") {
    for (const commit of [true, false]) {
      const { transactionId } = await client.beginTransaction(target);
      try {
        await client.batchExecuteStatement({
          ...target,
          transactionId,
          sql: "INSERT INTO items (id, marker, source) VALUES (:id, :marker, :source)",
          parameterSets: [0, 1].map((index) => [
            {
              name: "id",
              value: { stringValue: `${event.id}-${commit}-${index}` },
            },
            { name: "marker", value: { stringValue: marker } },
            {
              name: "source",
              value: { stringValue: commit ? "committed" : "rolled-back" },
            },
          ]),
        });
        if (commit)
          await client.commitTransaction({ ...target, transactionId });
        else await client.rollbackTransaction({ ...target, transactionId });
      } catch (error) {
        await client
          .rollbackTransaction({ ...target, transactionId })
          .catch(() => {});
        throw error;
      }
    }
  }
  return {
    marker,
    version,
    request: context.awsRequestId,
    bucket: Bucket.Files.bucketName,
    queue: Queue.Work.queueUrl,
    database: target,
    items: await db.selectFrom("items").selectAll().orderBy("id").execute(),
  };
}

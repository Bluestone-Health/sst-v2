import "../network-guard.cjs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Bucket } from "sst/node/bucket";
import { db } from "./database";

const s3 = new S3Client({ forcePathStyle: true });
export async function main(event, context) {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      if (body.Event === "s3:TestEvent") continue;
      if (
        body.crashOnce &&
        Number(record.attributes.ApproximateReceiveCount) === 1
      )
        process.exit(1);
      if (
        body.failOnce &&
        Number(record.attributes.ApproximateReceiveCount) === 1
      )
        throw new Error("intentional first-attempt failure");
      const items = body.Records
        ? await Promise.all(
            body.Records.map(async (created) => {
              const id = decodeURIComponent(
                created.s3.object.key.replace(/\+/g, " ")
              );
              const object = await s3.send(
                new GetObjectCommand({
                  Bucket: Bucket.Files.bucketName,
                  Key: id,
                })
              );
              return {
                id,
                marker: await object.Body!.transformToString(),
                source: "s3",
              };
            })
          )
        : [{ id: body.id, marker: body.marker, source: "sqs" }];
      for (const item of items) {
        if (item.marker !== process.env.MARKER)
          throw new Error("Cross-environment marker rejected");
        await db
          .insertInto("items")
          .values(item)
          .onConflict((conflict) => conflict.column("id").doNothing())
          .execute();
      }
      console.log({
        marker: process.env.MARKER,
        request: context.awsRequestId,
        message: record.messageId,
        attempts: record.attributes.ApproximateReceiveCount,
      });
    } catch (error) {
      console.error(error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

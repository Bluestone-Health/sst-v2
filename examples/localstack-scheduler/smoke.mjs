import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import AWS from "aws-sdk";

const id = process.argv[2] || "scheduler";
const endpoint = process.argv[3] || "http://127.0.0.1:4569";
const url = new URL(endpoint);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.protocol, "http:");
const outputs = JSON.parse(
  await readFile(`.sst/local/${id}/outputs.json`, "utf8")
);
const options = {
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};
const db = new AWS.DynamoDB.DocumentClient(options);
const lambda = new AWS.Lambda(options);
const codebuild = new AWS.CodeBuild(options);
const key = randomUUID();
const post = (route, body, auth = "local-test") =>
  fetch(`${outputs.ApiUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
async function wait(check, label, seconds = 180) {
  for (let i = 0; i < seconds; i++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const row = async (id) =>
  (
    await db
      .get({ TableName: outputs.TableName, Key: { id }, ConsistentRead: true })
      .promise()
  ).Item;
assert.ok(
  await row("script-created"),
  "Packaged Script must execute during deployment"
);
assert.ok(
  [401, 403].includes((await post("/exercise", { id: key }, "wrong")).status)
);
const preflight = await fetch(`${outputs.ApiUrl}/exercise`, {
  method: "OPTIONS",
  headers: {
    origin: "http://localhost:3000",
    "access-control-request-method": "POST",
  },
});
assert.equal(
  preflight.headers.get("access-control-allow-origin"),
  "http://localhost:3000"
);
const response = await post("/exercise", { id: key, delay: 15000 });
const body = await response.text();
assert.equal(response.status, 200, body);
const result = JSON.parse(body);
assert.equal(result.secret, "local-only-value");
assert.ok(result.jobId);
assert.ok(
  (await post("/exercise", { id: key })).status >= 400,
  "DynamoDB condition must reject duplicate writes"
);
for (const suffix of ["fifo-1", "fifo-2", "sns", "job"])
  await wait(() => row(`${key}-${suffix}`), suffix, 300);
const index = await db
  .query({
    TableName: outputs.TableName,
    IndexName: "byCategory",
    KeyConditionExpression: "category = :c",
    ExpressionAttributeValues: { ":c": "local" },
  })
  .promise();
assert.ok(index.Count > 0);
assert.equal(
  (
    await new AWS.DynamoDB(options)
      .describeTimeToLive({ TableName: outputs.TableName })
      .promise()
  ).TimeToLiveDescription.AttributeName,
  "expires"
);
const queueUrl = (value) => endpoint + new URL(value).pathname;
const sqs = new AWS.SQS(options);
await sqs
  .sendMessage({
    QueueUrl: queueUrl(outputs.QueueUrl),
    MessageBody: JSON.stringify({ id: key, fail: true }),
    MessageGroupId: key,
  })
  .promise();
await wait(
  async () =>
    (
      await sqs
        .receiveMessage({
          QueueUrl: queueUrl(outputs.DeadLetterUrl),
          WaitTimeSeconds: 1,
        })
        .promise()
    ).Messages?.length,
  "FIFO retry to DLQ",
  120
);
await lambda
  .invoke({
    FunctionName: outputs.TickFunction,
    Payload: JSON.stringify({ id: `${key}-tick` }),
  })
  .promise();
assert.ok(await row(`${key}-tick`));
const schedules = await new AWS.Scheduler(options).listSchedules({}).promise();
assert.ok(schedules.Schedules.length > 0);
assert.ok(schedules.Schedules.every((s) => s.State === "DISABLED"));
await new AWS.S3({ ...options, s3ForcePathStyle: true })
  .putObject({
    Bucket: outputs.BucketName,
    Key: `email/${key}.eml`,
    Body: "From: local@example.test\r\nTo: inbound@example.test\r\nSubject: Local\r\n\r\nTest",
  })
  .promise();
await wait(() => row(`email-email/${key}.eml`), "email S3 trigger");
const ses = new AWS.SES(options);
await ses.verifyEmailIdentity({ EmailAddress: "local@example.test" }).promise();
await ses
  .sendEmail({
    Source: "local@example.test",
    Destination: { ToAddresses: ["inbound@example.test"] },
    Message: {
      Subject: { Data: key },
      Body: { Text: { Data: "Captured locally" } },
    },
  })
  .promise();
const mail = await (await fetch(`${endpoint}/_aws/ses`)).json();
assert.ok(mail.messages.some((m) => m.Subject === key));
// Record the emulator limitation rather than pretending cancellation succeeded.
await assert.rejects(
  codebuild.stopBuild({ id: result.jobId }).promise(),
  (error) => error.statusCode === 501
);
console.log(
  "PASS: HTTP authorization/CORS, DynamoDB/index/TTL configuration, FIFO/DLQ, SNS, Job execution, manual schedule, inbound S3 event, captured SES; CodeBuild cancellation limitation confirmed"
);

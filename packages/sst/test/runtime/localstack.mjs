// Real LocalStack transport gate. Run from packages/sst; all resources are disposable.
import AWS from "aws-sdk";
import AdmZip from "adm-zip";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { setProject } from "../../dist/project.js";
import { useFunctions } from "../../dist/constructs/Function.js";
import { useBus } from "../../dist/bus.js";
import { startLocalBridge } from "../../dist/runtime/local.js";

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://127.0.0.1:4567";
assert.equal(
  new URL(endpoint).hostname,
  "127.0.0.1",
  "Probe only accepts local loopback endpoints"
);
const config = {
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  maxRetries: 1,
};
const lambda = new AWS.Lambda(config);
const sqs = new AWS.SQS(config);
const root = await mkdtemp(path.join(tmpdir(), "sst-localstack-probe-"));
await mkdir(path.join(root, ".sst"));
await writeFile(path.join(root, "package.json"), '{"type":"module"}');
const output = path.join(root, "events.jsonl");
await writeFile(
  path.join(root, "handler.ts"),
  `
  import { appendFile } from "node:fs/promises";
  export async function main(event, context) {
    if (event.fail) throw new Error("intentional probe error");
    if (event.timeout) while (true) {}
    if (event.Records) {
      for (const record of event.Records) {
        await appendFile(process.env.PROBE_OUTPUT, JSON.stringify({ record, request: context.awsRequestId }) + "\\n");
        if (record.body === "retry" && record.attributes.ApproximateReceiveCount === "1") throw new Error("retry me");
      }
    }
    return { marker: event.marker, request: context.awsRequestId, bound: process.env.SST_Bucket_bucketName_Files };
  }
`
);
setProject({
  config: { name: "probe", stage: "local", region: "us-east-1" },
  paths: {
    root,
    out: path.join(root, ".sst"),
    artifacts: path.join(root, ".sst/artifacts"),
  },
});
useFunctions().add("handler", {
  runtime: "nodejs22.x",
  handler: path.join(root, "handler.main"),
});
useBus().subscribe("worker.stdout", (evt) =>
  console.log("worker", evt.properties.requestID, evt.properties.message)
);
useBus().subscribe("function.build.failed", (evt) =>
  console.error(evt.properties.errors)
);
const token = randomBytes(32).toString("hex");
const bridge = await startLocalBridge({ host: "0.0.0.0", port: 0, token });
const name = `sst-local-probe-${randomBytes(5).toString("hex")}`;
let queueUrl, mapping;
let exitCode = 1;
try {
  const zip = new AdmZip();
  zip.addFile(
    "index.mjs",
    await readFile(
      new URL("../../dist/support/local-bridge/index.mjs", import.meta.url)
    )
  );
  const fn = await lambda
    .createFunction({
      FunctionName: name,
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Handler: "index.handler",
      Timeout: 3,
      Role: "arn:aws:iam::000000000000:role/local-probe",
      Code: { ZipFile: zip.toBuffer() },
      Environment: {
        Variables: {
          SST_FUNCTION_ID: "handler",
          SST_LOCAL_BRIDGE_TOKEN: token,
          SST_LOCAL_BRIDGE_URL: `http://host.docker.internal:${
            bridge.address().port
          }`,
          SST_Bucket_bucketName_Files: "probe-bucket",
          PROBE_OUTPUT: output,
        },
      },
    })
    .promise();
  await lambda
    .waitFor("functionActiveV2", {
      FunctionName: name,
      $waiter: { delay: 1, maxAttempts: 120 },
    })
    .promise();
  const invoke = (event) =>
    lambda
      .invoke({ FunctionName: name, Payload: JSON.stringify(event) })
      .promise();
  const success = await invoke({ marker: name });
  assert.equal(success.FunctionError, undefined, String(success.Payload));
  assert.equal(JSON.parse(success.Payload).marker, name);
  assert.equal(JSON.parse(success.Payload).bound, "probe-bucket");
  assert.ok((await invoke({ fail: true })).FunctionError);
  assert.ok((await invoke({ timeout: true })).FunctionError);
  queueUrl = (
    await sqs
      .createQueue({ QueueName: name, Attributes: { VisibilityTimeout: "6" } })
      .promise()
  ).QueueUrl;
  const attributes = await sqs
    .getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] })
    .promise();
  mapping = (
    await lambda
      .createEventSourceMapping({
        FunctionName: fn.FunctionArn,
        EventSourceArn: attributes.Attributes.QueueArn,
        BatchSize: 1,
      })
      .promise()
  ).UUID;
  await sqs.sendMessage({ QueueUrl: queueUrl, MessageBody: "retry" }).promise();
  let events = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    events = await readFile(output, "utf8")
      .then((data) => data.trim().split("\n").map(JSON.parse))
      .catch(() => []);
    if (
      events.some(
        (evt) => Number(evt.record.attributes.ApproximateReceiveCount) > 1
      )
    )
      break;
  }
  assert.ok(events.some((evt) => evt.record.eventSource === "aws:sqs"));
  assert.ok(
    events.some(
      (evt) => Number(evt.record.attributes.ApproximateReceiveCount) > 1
    ),
    "Failed work must be retried"
  );
  assert.ok(events.every((evt) => evt.record.body === "retry" && evt.request));
  let remaining;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await sqs
      .getQueueAttributes({
        QueueUrl: queueUrl,
        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
        ],
      })
      .promise();
    remaining = Object.values(result.Attributes).reduce(
      (sum, value) => sum + Number(value),
      0
    );
    if (remaining === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(remaining, 0, "Successful retry must acknowledge the message");
  console.log(
    JSON.stringify({
      result: "PASS",
      endpoint,
      name,
      deliveries: events.length,
      checks: [
        "handler",
        "bindings",
        "error",
        "timeout",
        "SQS retry",
        "SQS acknowledgement",
        "container-to-host route",
      ],
    })
  );
  exitCode = 0;
} catch (error) {
  console.error(error);
} finally {
  if (mapping)
    await lambda
      .deleteEventSourceMapping({ UUID: mapping })
      .promise()
      .catch(console.error);
  if (queueUrl)
    await sqs
      .deleteQueue({ QueueUrl: queueUrl })
      .promise()
      .catch(console.error);
  await lambda
    .deleteFunction({ FunctionName: name })
    .promise()
    .catch(console.error);
  bridge.close();
  await rm(root, { recursive: true, force: true });
  process.exit(exitCode);
}

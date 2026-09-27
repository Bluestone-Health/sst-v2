import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const [url = "http://127.0.0.1:3001", marker = "alpha"] = process.argv.slice(2);
assert.equal(new URL(url).hostname, "127.0.0.1");
const invoke = async (event) => {
  const response = await fetch(`${url}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.marker, marker);
  return value;
};
const upload = await invoke({ action: "upload" });
assert.equal(new URL(upload.upload).hostname, "127.0.0.1");
assert.equal(
  (await fetch(upload.upload, { method: "PUT", body: marker })).status,
  200
);
assert.equal(await (await fetch(upload.download)).text(), marker);
const queue = await invoke({ action: "queue", failOnce: true });
const transaction = randomUUID();
const written = await invoke({ action: "transactions", id: transaction });
assert.equal(
  written.items.filter((row) => row.id.startsWith(transaction)).length,
  2
);
assert.ok(
  written.items
    .filter((row) => row.id.startsWith(transaction))
    .every((row) => row.source === "committed")
);
let read;
for (let attempt = 0; attempt < 90; attempt++) {
  read = await invoke({ action: "read" });
  if (
    read.items.some((row) => row.id === upload.key) &&
    read.items.some((row) => row.id === queue.id)
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(
  read.items.some((row) => row.id === upload.key && row.source === "s3"),
  "S3 notification must reach PostgreSQL through SQS"
);
assert.ok(
  read.items.some((row) => row.id === queue.id && row.source === "sqs"),
  "Failed queue item must retry successfully"
);
assert.ok(
  read.items.every((row) => row.marker === marker),
  "No cross-environment rows"
);
console.log(
  JSON.stringify({
    result: "PASS",
    marker,
    version: read.version,
    bucket: read.bucket,
    queue: read.queue,
    rows: read.items.length,
  })
);

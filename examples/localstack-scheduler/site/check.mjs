import assert from "node:assert/strict";
import { Config } from "sst/node/config";
import { Table } from "sst/node/table";
assert.equal(Config.LOCAL_TEST_SECRET, "local-only-value");
assert.ok(Table.Records.tableName);
assert.match(
  process.env.API_URL,
  /^http:\/\/.+\.execute-api\.localhost\.localstack\.cloud:4569$/
);
assert.equal(process.env.AWS_ACCESS_KEY_ID, "test");
assert.equal(process.env.AWS_ENDPOINT_URL, "http://127.0.0.1:4569");
console.log(
  "PASS: site environment, resource/secret bindings, local endpoint and credentials"
);

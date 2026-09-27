import AWS from "aws-sdk";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://127.0.0.1:4567";
assert.equal(new URL(endpoint).hostname, "127.0.0.1");
const config = {
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  maxRetries: 1,
};
const rds = new AWS.RDS(config);
const secrets = new AWS.SecretsManager(config);
const data = new AWS.RDSDataService(config);
const name = `sst-data-probe-${randomBytes(4).toString("hex")}`;
let secretArn;
try {
  const cluster = await rds
    .createDBCluster({
      DBClusterIdentifier: name,
      Engine: "aurora-postgresql",
      EngineVersion: "17.7",
      DatabaseName: "probe",
      MasterUsername: "postgres",
      MasterUserPassword: "local-probe-password",
      EnableHttpEndpoint: true,
    })
    .promise();
  await rds
    .createDBInstance({
      DBInstanceIdentifier: name,
      DBClusterIdentifier: name,
      Engine: "aurora-postgresql",
      DBInstanceClass: "db.serverless",
    })
    .promise();
  secretArn = (
    await secrets
      .createSecret({
        Name: name,
        SecretString: JSON.stringify({
          username: "postgres",
          password: "local-probe-password",
        }),
      })
      .promise()
  ).ARN;
  const target = { resourceArn: cluster.DBCluster.DBClusterArn, secretArn };
  const statement = (sql, transactionId) =>
    data
      .executeStatement({ ...target, database: "probe", sql, transactionId })
      .promise();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await statement("SELECT 1");
      ready = true;
      break;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  assert.ok(ready);
  await statement("CREATE TABLE probe (marker text PRIMARY KEY)");
  const commit = await data
    .beginTransaction({ ...target, database: "probe" })
    .promise();
  await statement(
    "INSERT INTO probe VALUES ('committed')",
    commit.transactionId
  );
  await data
    .commitTransaction({ ...target, transactionId: commit.transactionId })
    .promise();
  const rollback = await data
    .beginTransaction({ ...target, database: "probe" })
    .promise();
  await data
    .batchExecuteStatement({
      ...target,
      database: "probe",
      transactionId: rollback.transactionId,
      sql: "INSERT INTO probe VALUES (:marker)",
      parameterSets: ["discard-a", "discard-b"].map((marker) => [
        { name: "marker", value: { stringValue: marker } },
      ]),
    })
    .promise();
  await data
    .rollbackTransaction({ ...target, transactionId: rollback.transactionId })
    .promise();
  const rows = await statement("SELECT marker FROM probe ORDER BY marker");
  assert.deepEqual(rows.records, [[{ stringValue: "committed" }]]);
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "PostgreSQL 17.7 requested",
        "Data API",
        "write",
        "commit",
        "batch",
        "rollback",
      ],
    })
  );
} finally {
  await rds
    .deleteDBInstance({ DBInstanceIdentifier: name, SkipFinalSnapshot: true })
    .promise()
    .catch(console.error);
  await rds
    .deleteDBCluster({ DBClusterIdentifier: name, SkipFinalSnapshot: true })
    .promise()
    .catch(console.error);
  if (secretArn)
    await secrets
      .deleteSecret({ SecretId: secretArn, ForceDeleteWithoutRecovery: true })
      .promise();
}

import { expect, test } from "vitest";
import {
  rewriteTextCasts,
  rewriteDoBlock,
  localDataApi,
} from "../dist/runtime/local-data-api.js";
import express from "express";
import { once } from "node:events";
import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";

test("local Data API gives same-named text casts unique wire aliases", () => {
  const query = rewriteTextCasts(
    'select *, "dob"::text as "dob", "p"."start_date"::text as "start_date" from "patients" where "id" = :1 order by "created_at"'
  );
  expect(query.sql).toBe(
    'select *, "dob"::text as "sst_local_text_0", "p"."start_date"::text as "sst_local_text_1" from "patients" where "id" = :1 order by "created_at"'
  );
  expect(query.aliases).toEqual({
    sst_local_text_0: "dob",
    sst_local_text_1: "start_date",
  });
});

test("local Data API leaves SQL outside the supported projection pattern intact", () => {
  for (const sql of [
    'select "dob"::text as "birth_date" from "patients"',
    `select '"dob"::text as "dob"'`,
    `select $$"dob"::text as "dob"$$`,
    `select $tag$"dob"::text as "dob"$tag$`,
    'select /* "dob"::text as "dob" */ 1',
    'select -- "dob"::text as "dob"\n1',
    'with p as (select "dob"::text as "dob" from "patients") select * from p',
    'select * from (select "dob"::text as "dob" from "patients") p',
    'select "dob"::text as "dob" from "patients" order by "dob"',
    'select "dob"::text as "dob" from "patients" union select "dob" from p',
    'select "dob"::text as "dob" into "patients_copy" from "patients"',
    'select "dob"::text as "dob" from "patients"; select 1',
  ]) {
    expect(rewriteTextCasts(sql)).toEqual({ sql, aliases: {} });
  }
});

test("local Data API preserves SDK records, transaction payloads and upstream failures", async () => {
  const backend = express();
  backend.use(express.json());
  let received: any;
  backend.post("/:action", (req, res) => {
    received = req.body;
    expect(req.headers.authorization).toContain("Credential=test/");
    if (req.body.sql === "fail") {
      res
        .status(400)
        .set("x-amzn-errortype", "BadRequestException")
        .json({ message: "bad query" });
    } else if (req.params.action !== "Execute") {
      res.json({
        transactionId: "transaction",
        transactionStatus: "Transaction Committed",
      });
    } else {
      res.json({
        columnMetadata: [
          { name: "dob", label: "dob", typeName: "date" },
          {
            name: "sst_local_text_0",
            label: "sst_local_text_0",
            typeName: "text",
          },
          { name: "blob", typeName: "bytea" },
          { name: "constructor", typeName: "text" },
        ],
        records: [
          [
            { stringValue: "1979-01-19" },
            { stringValue: "1979-01-19" },
            { blobValue: "AQID" },
            { stringValue: "preserved" },
          ],
        ],
      });
    }
  });
  const upstream = backend.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const api = express();
  api.post(
    "/rds-data/token/:action",
    express.json(),
    localDataApi({
      endpoint: `http://127.0.0.1:${(upstream.address() as any).port}`,
      region: "us-east-1",
    })
  );
  const server = api.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${
    (server.address() as any).port
  }/rds-data/token`;
  const client = new RDSDataClient({
    endpoint,
    region: "us-east-1",
    maxAttempts: 1,
    credentials: { accessKeyId: "caller", secretAccessKey: "caller" },
  });
  try {
    const input = {
      database: "db",
      resourceArn: "resource",
      secretArn: "secret",
      transactionId: "tx",
      parameters: [{ name: "1", value: { stringValue: "patient" } }],
      includeResultMetadata: true,
      sql: 'select *, "dob"::text as "dob" from "patients" where id = :1',
    };
    const result = await client.send(new ExecuteStatementCommand(input));
    expect(received).toEqual({
      ...input,
      sql: rewriteTextCasts(input.sql).sql,
    });
    expect(result.columnMetadata?.map((c) => [c.name, c.typeName])).toEqual([
      ["dob", "date"],
      ["dob", "text"],
      ["blob", "bytea"],
      ["constructor", "text"],
    ]);
    expect(result.records?.[0][2].blobValue).toEqual(new Uint8Array([1, 2, 3]));
    await expect(
      client.send(new ExecuteStatementCommand({ ...input, sql: "fail" }))
    ).rejects.toMatchObject({
      name: "BadRequestException",
      message: "bad query",
    });
    await client.send(
      new ExecuteStatementCommand({
        ...input,
        sql: "DO $$ BEGIN PERFORM 1; END $$;",
      })
    );
    expect(received.sql).toBe(String.raw`DO E' BEGIN PERFORM 1\073 END '`);
    expect(received.transactionId).toBe(input.transactionId);
    for (const action of [
      "BatchExecute",
      "BeginTransaction",
      "CommitTransaction",
      "RollbackTransaction",
    ]) {
      const response = await fetch(`${endpoint}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: "tx" }),
      });
      expect(response.status).toBe(200);
      expect(received).toEqual({ transactionId: "tx" });
    }
    await client.send(
      new ExecuteStatementCommand({ ...input, formatRecordsAs: "JSON" })
    );
    expect(received.sql).toBe(input.sql);
  } finally {
    client.destroy();
    server.close();
    upstream.close();
  }
});

test("local Data API preserves escaped identifiers and avoids alias collisions", () => {
  const query = rewriteTextCasts(
    'select "sst_local_text_0", "a""b"::text as "a""b" from "patients"'
  );
  expect(query.aliases).toEqual({ sst_local_text_1: 'a"b' });
  expect(query.sql).toContain('"a""b"::text as "sst_local_text_1"');
});

test("local Data API encodes a complete dollar-quoted DO block without changing its body", () => {
  const sql = String.raw`DO $guard$ BEGIN RAISE EXCEPTION 'can''t; use \\ paths'; END $guard$;`;
  expect(rewriteDoBlock(sql)).toBe(
    String.raw`DO E' BEGIN RAISE EXCEPTION ''can''''t\073 use \\\\ paths''\073 END '`
  );
  expect(rewriteDoBlock("DO $$ BEGIN PERFORM 1; END $$;")).toBe(
    String.raw`DO E' BEGIN PERFORM 1\073 END '`
  );
});

test("local Data API leaves unsupported procedural and multiple statements unchanged", () => {
  for (const sql of [
    "select 1; select 2",
    "DO 'BEGIN PERFORM 1; END'",
    "DO $$ BEGIN PERFORM 1; END $other$;",
    "DO $lower$ BEGIN PERFORM 1; END $LOWER$;",
    "DO $$ BEGIN PERFORM 1; END $$; DO $$ BEGIN PERFORM 2; END $$;",
    "DO $$ BEGIN PERFORM 1; END $$; select 2",
    "-- DO $$ BEGIN PERFORM 1; END $$;",
  ])
    expect(rewriteDoBlock(sql)).toBe(sql);
});

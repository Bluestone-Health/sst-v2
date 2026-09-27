import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";

// Real compiler, watcher, Runtime API, and worker threads; no handler imports/mocks.
test("local bridge isolates real invocations, failures, deadlines and reloads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sst-local-"));
  const token = randomBytes(32).toString("hex");
  const source = (version: string) => `
    export async function main(event, context) {
      if (event.fail) throw new Error("probe failure");
      if (event.timeout) while (true) {}
      if (event.exit) process.exit(1);
      await new Promise(resolve => setTimeout(resolve, event.delay || 0));
      return { version: "${version}", marker: event.marker,
        bound: process.env.SST_Bucket_bucketName_Files,
        request: context.awsRequestId, name: context.functionName,
        remaining: context.getRemainingTimeInMillis(),
        hostSecret: process.env.PROBE_HOST_SECRET,
        accessKey: process.env.AWS_ACCESS_KEY_ID,
        endpoint: process.env.AWS_ENDPOINT_URL,
        queue: process.env.SST_Queue_queueUrl_Work,
        bridgeSecret: process.env.SST_LOCAL_BRIDGE_TOKEN };
    }`;
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(path.join(root, "handler.ts"), source("one"));
  const child = spawn(
    process.execPath,
    [path.resolve("test/runtime/local.fixture.mjs"), root],
    {
      cwd: root,
      env: {
        ...process.env,
        PROBE_TOKEN: token,
        PROBE_HOST_SECRET: "must-not-leak",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Bridge startup timed out: ${stderr}`)),
        10000
      );
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(stderr));
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (!line.startsWith('{"port":')) return;
        clearTimeout(timer);
        resolve(JSON.parse(line).port);
      });
    });
    const url = `http://127.0.0.1:${port}/invoke`;
    const invoke = async (
      event: object,
      overrides: object = {},
      key = token
    ) => {
      const requestID = randomUUID();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          functionID: "handler",
          requestID,
          event,
          deadline: 5000,
          context: {
            awsRequestId: requestID,
            invokedFunctionArn:
              "arn:aws:lambda:us-east-1:000000000000:function:probe",
            logGroupName: "/aws/lambda/probe",
            logStreamName: "probe",
          },
          env: {
            SST_Bucket_bucketName_Files: "files-a",
            AWS_LAMBDA_FUNCTION_NAME: "probe",
            SST_LOCAL_BRIDGE_TOKEN: "must-not-leak",
          },
          ...overrides,
        }),
      });
      return {
        status: response.status,
        body: await response.json(),
        requestID,
      };
    };
    expect((await invoke({}, {}, "wrong")).status).toBe(401);
    expect((await invoke({}, { functionID: "missing" })).status).toBe(400);
    expect((await invoke({}, { functionID: "unsupported" })).status).toBe(400);
    expect((await invoke({}, { deadline: -1 })).status).toBe(400);
    const replies = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        invoke(
          { marker: String(index), delay: 80 },
          {
            env: {
              SST_Bucket_bucketName_Files: `files-${index}`,
              SST_Queue_queueUrl_Work:
                "http://localhost:4566/queue/us-east-1/000000000000/work",
              AWS_ACCESS_KEY_ID: "must-not-survive",
              AWS_ENDPOINT_URL: "https://sqs.us-east-1.amazonaws.com",
              AWS_LAMBDA_FUNCTION_NAME: "probe",
            },
          }
        )
      )
    );
    for (const [index, reply] of replies.entries()) {
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toMatchObject({
        version: "one",
        marker: String(index),
        bound: `files-${index}`,
        accessKey: "test",
        endpoint: "http://127.0.0.1:4567",
        queue: "http://127.0.0.1:4567/queue/us-east-1/000000000000/work",
        request: reply.requestID,
        name: "probe",
      });
      expect(reply.body.remaining).toBeGreaterThan(0);
      expect(reply.body).not.toHaveProperty("hostSecret");
      expect(reply.body).not.toHaveProperty("bridgeSecret");
    }
    expect((await invoke({ fail: true })).body.errorMessage).toBe(
      "probe failure"
    );
    expect((await invoke({ timeout: true }, { deadline: 150 })).status).toBe(
      504
    );
    expect((await invoke({ exit: true })).status).toBe(502);
    expect((await invoke({ marker: "after-timeout" })).status).toBe(200);
    await writeFile(path.join(root, "handler.ts"), source("two"));
    let version = "one";
    for (let attempt = 0; attempt < 30 && version !== "two"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      version = (await invoke({})).body.version;
    }
    expect(version).toBe("two");
    await writeFile(
      path.join(root, "handler.ts"),
      "export async function main( {"
    );
    let failed = false;
    for (let attempt = 0; attempt < 30 && !failed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      failed = (await invoke({})).body.errorType === "BuildError";
    }
    expect(failed, "Broken edits must fail instead of running stale code").toBe(
      true
    );
    await writeFile(path.join(root, "handler.ts"), source("fixed"));
    for (let attempt = 0; attempt < 30 && version !== "fixed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      version = (await invoke({})).body.version;
    }
    expect(version).toBe("fixed");
  } catch (error) {
    throw new Error(`${error}\nChild stderr:\n${stderr}`, { cause: error });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  }
});

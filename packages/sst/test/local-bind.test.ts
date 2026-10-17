import { expect, test } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import kill from "tree-kill";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

test("local bind rejects inherited secrets and binds only local site values", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "sst-local-bind-"))
  );
  let deployed = false;
  const prefix = "/sst/review/local-review/";
  const secretName = prefix + "Secret/REVIEW_SENTINEL/value";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    const target = req.headers["x-amz-target"];
    const parameters =
      deployed && input.Path === prefix
        ? [
            { Name: prefix + "Table/Records/tableName", Value: "local-table" },
            { Name: secretName, Value: "synthetic-local-secret" },
          ]
        : [];
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.method === "GET"
          ? {
              Environment: {
                Variables: {
                  SST_Secret_value_REVIEW_SENTINEL: "__FETCH_FROM_SSM__",
                  SST_Table_tableName_Records: "local-table",
                  SITE_URL: "http://localhost:3000",
                },
              },
            }
          : target === "AmazonSSM.GetParameters"
          ? {
              Parameters: [
                { Name: secretName, Value: "synthetic-local-secret" },
              ],
            }
          : { Parameters: parameters }
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}`;
  async function bind(cwd: string, script: string) {
    await writeFile(path.join(cwd, "check.mjs"), script);
    return await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            path.join(dist, "cli/sst.js"),
            "bind",
            "--local",
            "--env",
            "review",
            "--endpoint",
            endpoint,
            process.execPath,
            "check.mjs",
          ],
          {
            cwd,
            env: {
              ...process.env,
              SST_Secret_value_REVIEW_SENTINEL: "synthetic-parent-secret",
              SST_Table_tableName_Records: "synthetic-parent-table",
            },
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
        const timer = setTimeout(() => {
          if (child.pid) kill(child.pid, "SIGKILL");
          reject(new Error("Local bind subprocess timed out"));
        }, 10000);
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      }
    );
  }
  try {
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "sst.config.mjs"),
      'export default {config(){return {name:"review",region:"us-east-1"}},stacks(){}}'
    );
    const out = path.join(root, ".sst/local/review");
    const bridgeToken = "local-bind-token-with-more-than-32-characters";
    const dataEndpoint = `http://127.0.0.1:13573/rds-data/${bridgeToken}`;
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, "bridge.json"),
      JSON.stringify({ port: 13573 })
    );
    await writeFile(path.join(out, "bridge-token"), bridgeToken, {
      mode: 0o600,
    });
    const missing = `import assert from 'node:assert/strict';
      import {Config} from ${JSON.stringify(
        new URL("node/config/index.js", `file://${dist}`).href
      )};
      assert.equal(process.env.SST_Table_tableName_Records, undefined);
      console.log(Config.REVIEW_SENTINEL);`;
    for (const dotenv of [false, true]) {
      if (dotenv)
        await writeFile(
          path.join(root, ".env"),
          "SST_Secret_value_REVIEW_SENTINEL=synthetic-file-secret\nSST_Table_tableName_Records=synthetic-file-table\n"
        );
      const result = await bind(root, missing);
      expect(result.code).toBe(1);
      expect(result.output).toContain("Cannot use Config.REVIEW_SENTINEL");
    }
    deployed = true;
    const scriptResult = await bind(
      root,
      `import assert from 'node:assert/strict';
      import {Config} from ${JSON.stringify(
        new URL("node/config/index.js", `file://${dist}`).href
      )};
      import {Table} from ${JSON.stringify(
        new URL("node/table/index.js", `file://${dist}`).href
      )};
      assert.equal(Config.REVIEW_SENTINEL, 'synthetic-local-secret');
      assert.equal(Table.Records.tableName, 'local-table');
      assert.equal(process.env.AWS_ENDPOINT_URL_RDS_DATA, ${JSON.stringify(
        dataEndpoint
      )});
      console.log('local script bindings passed');`
    );
    expect(scriptResult.code, scriptResult.output).toBe(0);
    expect(scriptResult.output).toContain("local script bindings passed");
    const site = path.join(root, "site");
    await mkdir(site);
    await writeFile(
      path.join(out, "sites.json"),
      JSON.stringify({ [site]: "local-site" })
    );
    const result = await bind(
      site,
      `import assert from 'node:assert/strict';
      import {Config} from ${JSON.stringify(
        new URL("node/config/index.js", `file://${dist}`).href
      )};
      import {Table} from ${JSON.stringify(
        new URL("node/table/index.js", `file://${dist}`).href
      )};
      assert.equal(Config.REVIEW_SENTINEL, 'synthetic-local-secret');
      assert.equal(Table.Records.tableName, 'local-table');
      assert.equal(Config.STAGE, 'local-review');
      assert.equal(process.env.SITE_URL, 'http://localhost:3000');
      assert.equal(process.env.AWS_ENDPOINT_URL, ${JSON.stringify(endpoint)});
      assert.equal(process.env.AWS_ACCESS_KEY_ID, 'test');
      assert.equal(process.env.AWS_ENDPOINT_URL_RDS_DATA, ${JSON.stringify(
        dataEndpoint
      )});
      console.log('local site bindings passed');`
    );
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("local site bindings passed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

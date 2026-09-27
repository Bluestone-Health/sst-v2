import { test } from "vitest";
import { execFileSync } from "node:child_process";

test("network guard checks HTTP and HTTPS get and preserves local requests", () => {
  execFileSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require("node:assert/strict");
    require("../../examples/localstack/network-guard.cjs");
    for (const protocol of ["http", "https"]) {
      const client = require("node:" + protocol);
      for (const method of ["request", "get"]) {
        assert.throws(() => client[method](protocol + "://example.com", {
          createConnection() { throw new Error("guard bypassed"); }
        }), /Local verification blocked outbound request/);
      }
    }
    const http = require("node:http");
    const server = http.createServer((req, res) => res.end("local"));
    server.listen(0, "127.0.0.1", () => {
      http.get("http://127.0.0.1:" + server.address().port, res => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          assert.equal(body, "local");
          server.close();
        });
      }).on("error", error => { throw error; });
    });
  `,
    ],
    { timeout: 5000 }
  );
});

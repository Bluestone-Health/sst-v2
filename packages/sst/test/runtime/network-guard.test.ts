import { test } from "vitest";
import { execFileSync } from "node:child_process";

test("network guard checks effective HTTP destinations and rejects fetch redirects", () => {
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
        assert.throws(() => client[method](protocol + "://example.invalid"),
          /Local verification blocked outbound request/);
        for (const input of [protocol + "://127.0.0.1", new URL(protocol + "://127.0.0.1"), { hostname: "127.0.0.1" }]) {
          assert.throws(() => client[method](input, { hostname: "example.invalid" }),
            /Local verification blocked outbound request/);
        }
      }
    }
    const dns = require("node:dns");
    const lookup = dns.lookup;
    const attempted = [];
    dns.lookup = (host, ...args) => {
      if (host !== "example.invalid") return lookup(host, ...args);
      attempted.push(host);
      args.at(-1)(new Error("Forbidden DNS attempt"));
    };
    const http = require("node:http");
    const server = http.createServer((req, res) => {
      if (req.url === "/redirect") res.writeHead(302, { location: "http://example.invalid" });
      res.end("local");
    });
    server.listen(0, "127.0.0.1", async () => {
      try {
        const url = "http://127.0.0.1:" + server.address().port;
        const request = () => new Promise((resolve, reject) => {
          http.get(url, res => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => resolve(body));
          }).on("error", reject);
        });
        assert.equal(await request(), "local");
        assert.equal(await (await fetch(url)).text(), "local");
        await assert.rejects(fetch(url + "/redirect", { redirect: "follow" }));
        assert.deepEqual(attempted, []);
      } finally { server.close(); }
    });
  `,
    ],
    { timeout: 5000 }
  );
});

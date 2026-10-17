import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const guard = path.resolve("../../examples/localstack/network-guard.cjs");

test("verification guard covers isolated worker threads with explicit execArgv/env", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--require",
      guard,
      "-e",
      `
    const { Worker } = require('node:worker_threads');
    new Worker(\`
      const { parentPort } = require('node:worker_threads');
      try { require('node:https').request('https://example.com'); parentPort.postMessage('UNGUARDED'); }
      catch (error) { parentPort.postMessage(error.message); }
    \`, { eval: true, execArgv: [], env: {} }).on('message', console.log);
  `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );
  expect(output).toContain("blocked outbound request to example.com");
  expect(output).not.toContain("UNGUARDED");
});

test("verification guard updates built-in ESM request exports", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--require",
      guard,
      "--input-type=module",
      "-e",
      `
    import { request } from 'node:https';
    try { request('https://example.com'); console.log('UNGUARDED'); }
    catch (error) { console.log(error.message); }
  `,
    ],
    { encoding: "utf8", timeout: 10000 }
  );
  expect(output).toContain("blocked outbound request to example.com");
  expect(output).not.toContain("UNGUARDED");
});

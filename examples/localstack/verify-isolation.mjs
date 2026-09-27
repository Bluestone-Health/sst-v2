// Destructive verification of ONLY the two Compose projects named below.
// Run from checkout A's examples/localstack, after building/installing both checkouts.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

assert.equal(
  process.versions.node.split(".")[0],
  "22",
  "Run this check with Node 22"
);
assert.ok(
  process.env.LOCALSTACK_AUTH_TOKEN,
  "Set LOCALSTACK_AUTH_TOKEN without saving it in the repository"
);
assert.ok(process.argv[2], "Pass checkout B's repository root");
const roots = [
  process.cwd(),
  path.resolve(process.argv[2], "examples/localstack"),
];
assert.notEqual(
  await (await import("node:fs/promises")).realpath(roots[0]),
  await (await import("node:fs/promises")).realpath(roots[1])
);
const logs = await mkdtemp(path.join(tmpdir(), "sst-isolation-"));
console.log(`Logs: ${logs}`);
const environments = roots.map((root, index) => ({
  root,
  id: index ? "b" : "a",
  marker: index ? "beta" : "alpha",
  project: `sst-issue18-${index ? "b" : "a"}`,
  endpoint: `http://127.0.0.1:${4567 + index}`,
  bridge: 13559 + index,
  web: 3001 + index,
  env: {
    ...process.env,
    COMPOSE_PROJECT_NAME: `sst-issue18-${index ? "b" : "a"}`,
    LOCALSTACK_PORT: String(4567 + index),
    MARKER: index ? "beta" : "alpha",
    NODE_OPTIONS: `--require=${path.join(root, "network-guard.cjs")}`,
    SST_LOCAL_NETWORK_LOG: path.join(logs, `${index ? "b" : "a"}-network.log`),
  },
}));
const processes = [];
function run(executable, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}`))
    );
  });
}
function start(e, name, args) {
  const output = createWriteStream(path.join(logs, `${e.id}-${name}.log`), {
    flags: "a",
  });
  const child = spawn(process.execPath, args, {
    cwd: e.root,
    env: e.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output);
  child.stderr.pipe(output);
  child.on("error", (error) => output.write(String(error)));
  processes.push(child);
  return child;
}
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
async function waitFor(check, label, attempts = 180) {
  for (let n = 0; n < attempts; n++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}; inspect ${logs}`);
}
async function startSST(e) {
  const outputs = path.join(e.root, `.sst/local/${e.id}/outputs.json`);
  await rm(outputs, { force: true });
  const started = Date.now();
  e.sst = start(e, "sst", [
    "../../packages/sst/dist/cli/sst.js",
    "local",
    "--env",
    e.id,
    "--endpoint",
    e.endpoint,
    "--port",
    String(e.bridge),
  ]);
  await waitFor(async () => {
    if (e.sst.exitCode !== null)
      throw new Error(`SST ${e.id} failed; inspect ${logs}`);
    return readFile(outputs, "utf8").then(
      (data) => {
        e.outputs = JSON.parse(data);
        return true;
      },
      () => false
    );
  }, `${e.id} SST ready`);
  console.log(JSON.stringify({ env: e.id, startupMs: Date.now() - started }));
}
async function invoke(e, event) {
  const response = await fetch(`http://127.0.0.1:${e.web}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.marker, e.marker);
  return body;
}
const [a, b] = environments;
const versionFile = path.join(a.root, "src/version.ts");
const original = await readFile(versionFile, "utf8");
try {
  for (const e of environments) {
    await run("docker", ["compose", "up", "-d"], e.root, e.env);
    await waitFor(
      () =>
        fetch(`${e.endpoint}/_localstack/health`).then(
          (r) => r.ok,
          () => false
        ),
      `${e.id} Docker ready`
    );
  }
  await Promise.all(environments.map(startSST));
  for (const e of environments) {
    e.server = start(e, "web", ["server.mjs", e.id, e.endpoint, String(e.web)]);
    await waitFor(
      () =>
        fetch(`http://127.0.0.1:${e.web}`).then(
          (r) => r.ok,
          () => false
        ),
      `${e.id} HTTP ready`
    );
  }
  await Promise.all(
    environments.map((e) =>
      run(
        process.execPath,
        ["smoke.mjs", `http://127.0.0.1:${e.web}`, e.marker],
        e.root,
        e.env
      )
    )
  );
  const before = await Promise.all(
    environments.map((e) => invoke(e, { action: "read" }))
  );
  assert.notEqual(before[0].bucket, before[1].bucket);
  assert.notEqual(before[0].queue, before[1].queue);
  assert.notEqual(
    before[0].database.resourceArn,
    before[1].database.resourceArn
  );
  assert.equal(new URL(before[0].queue).origin, a.endpoint);
  assert.equal(new URL(before[1].queue).origin, b.endpoint);
  const editedAt = Date.now();
  await writeFile(versionFile, 'export const version = "edited-a";\n');
  await waitFor(
    async () => (await invoke(a, { action: "read" })).version === "edited-a",
    "A reload",
    30
  );
  console.log(JSON.stringify({ editMs: Date.now() - editedAt }));
  assert.equal(
    (await invoke(b, { action: "read" })).version,
    before[1].version
  );
  const crashed = await invoke(a, { action: "queue", crashOnce: true });
  await waitFor(
    async () =>
      (
        await invoke(a, { action: "read" })
      ).items.some((row) => row.id === crashed.id),
    "worker crash redelivery",
    60
  );
  await stop(a.sst);
  const queuedID = randomUUID();
  const sqs = new SQSClient({
    endpoint: a.endpoint,
    region: "us-east-1",
    useQueueUrlAsEndpoint: false,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: a.outputs.QueueUrl,
      MessageBody: JSON.stringify({ id: queuedID, marker: a.marker }),
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 16000));
  assert.ok(
    (await invoke(b, { action: "read" })).items.every(
      (row) => row.marker === b.marker
    )
  );
  await startSST(a);
  await waitFor(
    async () =>
      (
        await invoke(a, { action: "read" })
      ).items.some((row) => row.id === queuedID),
    "queue delivery after SST restart",
    60
  );
  const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((name) =>
      environments.some((e) => name.startsWith(`${e.project}-`))
    );
  console.log(
    execFileSync(
      "docker",
      [
        "stats",
        "--no-stream",
        "--format",
        "{{.Name}} {{.CPUPerc}} {{.MemUsage}}",
        ...containers,
      ],
      { encoding: "utf8" }
    )
  );
  console.log(
    execFileSync(
      "ps",
      [
        "-o",
        "pid,rss,%cpu,command",
        "-p",
        environments.flatMap((e) => [e.sst.pid, e.server.pid]).join(","),
      ],
      { encoding: "utf8" }
    )
  );
  await stop(a.sst);
  await stop(a.server);
  await run("docker", ["compose", "down", "--volumes"], a.root, a.env);
  assert.deepEqual(
    (await invoke(b, { action: "read" })).items,
    before[1].items
  );
  await run(
    process.execPath,
    ["smoke.mjs", `http://127.0.0.1:${b.web}`, b.marker],
    b.root,
    b.env
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: [
        "two checkouts",
        "S3/SQS/DB isolation",
        "edit isolation",
        "worker crash retry",
        "SST restart retry",
        "A reset leaves B working",
      ],
      logs,
    })
  );
} finally {
  await writeFile(versionFile, original);
  await Promise.all(processes.map(stop));
  for (const e of environments)
    await run("docker", ["compose", "down"], e.root, e.env);
}

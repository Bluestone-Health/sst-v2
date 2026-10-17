import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

test("dev --local enters local startup before cloud dev initialization", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sst-local-cli-"));
  try {
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "sst.config.ts"),
      'export default {config(){return {name:"local-cli",region:"us-east-1"}},stacks(){}}'
    );
    await mkdir(path.join(root, "node_modules"));
    await symlink(path.resolve("dist"), path.join(root, "node_modules/sst"));
    const result = await promisify(execFile)(
      process.execPath,
      [
        path.resolve("dist/cli/sst.js"),
        "dev",
        "--local",
        "--env",
        "test",
        "--endpoint",
        "http://127.0.0.1:9",
        "--port",
        "13573",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AWS_PROFILE: undefined,
          AWS_ACCESS_KEY_ID: "test",
          AWS_SECRET_ACCESS_KEY: "test",
          NODE_OPTIONS: `--require=${path.resolve(
            "../../examples/localstack/network-guard.cjs"
          )}`,
        },
        timeout: 15000,
      }
    ).catch((error) => ({
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    }));
    const output = result.stdout + result.stderr;
    expect(output).toContain("fetch failed");
    expect(output).not.toContain("--local is supported only");
    expect(output).not.toContain("blocked outbound");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

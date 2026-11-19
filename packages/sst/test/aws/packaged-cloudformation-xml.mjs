import spawn from "cross-spawn";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the shipped dependency graph outside the monorepo with the same XML
// security overrides as consumers. This also catches a stale dist manifest.
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "sst-cloudformation-xml-"));

function run(command, args, cwd = temporary) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
}

function runNpm(args, cwd = temporary) {
  // cross-spawn handles Windows command shims and argument escaping.
  const result = spawn.sync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    throw Object.assign(
      result.error ??
        new Error(`npm ${args[0]} failed (${result.signal ?? result.status})`),
      { stdout: result.stdout, stderr: result.stderr }
    );
  }
  return result.stdout;
}

try {
  const source = JSON.parse(readFileSync(join(packageRoot, "package.json")));
  const dist = JSON.parse(readFileSync(join(packageRoot, "dist/package.json")));
  assert.deepEqual(dist.dependencies, source.dependencies);

  const tarball = process.argv[2]
    ? resolve(process.argv[2])
    : join(
        temporary,
        JSON.parse(
          runNpm(
            [
              "pack",
              "--ignore-scripts",
              "--json",
              "--pack-destination",
              temporary,
            ],
            join(packageRoot, "dist")
          )
        )[0].filename
      );
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        sst: `file:${tarball}`,
        vitest: source.devDependencies.vitest,
      },
      overrides: {
        "fast-xml-parser@>=4 <4.5.7": "^4.5.7",
        "fast-xml-parser@>=5 <5.7.0": "^5.7.0",
      },
    })
  );
  console.log("Installing the packaged SST XML regression fixture...");
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"]);

  const require = createRequire(join(temporary, "package.json"));
  const sstRequire = createRequire(require.resolve("sst/package.json"));
  const installed = sstRequire("./package.json");
  assert.deepEqual(installed.dependencies, source.dependencies);
  assert.equal(installed.version, source.version);
  const toolkitRequire = createRequire(
    sstRequire.resolve("@aws-cdk/toolkit-lib")
  );
  copyFileSync(
    new URL("./cloudformation-xml.test.ts", import.meta.url),
    join(temporary, "cloudformation-xml.test.ts")
  );
  const vitest = join(
    dirname(require.resolve("vitest/package.json")),
    "vitest.mjs"
  );
  // CDK can resolve a different compatible version. Test each installed client.
  for (const [name, consumerRequire] of [
    ["SST", sstRequire],
    ["CDK", toolkitRequire],
  ]) {
    const clientPath = consumerRequire.resolve(
      "@aws-sdk/client-cloudformation"
    );
    const clientRequire = createRequire(clientPath);
    const coreRequire = createRequire(clientRequire.resolve("@aws-sdk/core"));
    const xmlRequire = createRequire(
      coreRequire.resolve("@aws-sdk/xml-builder")
    );
    const xmlPackage = coreRequire("@aws-sdk/xml-builder/package.json");
    if (xmlPackage.dependencies?.["fast-xml-parser"]) {
      const parser = xmlRequire("fast-xml-parser/package.json");
      const [major, minor] = parser.version.split(".").map(Number);
      assert.ok(major === 5 && minor >= 7);
      console.log(
        `${name} CloudFormation uses fast-xml-parser ${parser.version}`
      );
    } else {
      // Newer AWS releases replace fast-xml-parser with their own XML parser.
      console.log(
        `${name} CloudFormation uses AWS XML parser ${xmlPackage.version}`
      );
    }
    // Resolve aliases from installed packages, never the source checkout.
    writeFileSync(
      join(temporary, "vitest.config.mjs"),
      `export default ${JSON.stringify({
        resolve: {
          alias: {
            "@aws-sdk/client-cloudformation": clientPath,
            "@aws-sdk/middleware-retry": sstRequire.resolve(
              "@aws-sdk/middleware-retry"
            ),
          },
        },
        test: { threads: false },
      })}`
    );
    console.log(
      `Testing ${name} CloudFormation ${
        consumerRequire("@aws-sdk/client-cloudformation/package.json").version
      }`
    );
    console.log(
      run(process.execPath, [vitest, "run", "cloudformation-xml.test.ts"])
    );
  }
  const help = run(process.execPath, [
    sstRequire.resolve("./cli/sst.js"),
    "--help",
  ]);
  assert.ok(help.includes("Deploy your app to AWS"));
  console.log(`Packaged SST ${installed.version} CLI starts successfully`);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

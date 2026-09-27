import { useFunctions } from "../../dist/constructs/Function.js";
import { setProject } from "../../dist/project.js";
import { startLocalBridge } from "../../dist/runtime/local.js";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { useBus } from "../../dist/bus.js";

const root = process.argv[2];
process.chdir(root);
await mkdir(path.join(root, ".sst"), { recursive: true });
setProject({
  config: { name: "probe", stage: "local", region: "us-east-1" },
  paths: {
    root,
    out: path.join(root, ".sst"),
    artifacts: path.join(root, ".sst/artifacts"),
  },
});
useFunctions().add("handler", {
  runtime: "nodejs22.x",
  handler: path.join(root, "handler.main"),
});
useFunctions().add("unsupported", {
  runtime: "python3.11",
  handler: "handler.main",
});
useBus().subscribe("function.build.failed", (event) =>
  console.error(event.properties.errors)
);
const bridge = await startLocalBridge({
  host: "127.0.0.1",
  port: 0,
  token: process.env.PROBE_TOKEN,
});
console.log(JSON.stringify({ port: bridge.address().port }));

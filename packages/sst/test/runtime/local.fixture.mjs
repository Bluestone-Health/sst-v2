import { useFunctions } from "../../dist/constructs/Function.js";
import { setProject } from "../../dist/project.js";
import { startLocalBridge } from "../../dist/runtime/local.js";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { useBus } from "../../dist/bus.js";
import { configureLocal } from "../../dist/local.js";
import {
  useFunctionBuilder,
  useRuntimeHandlers,
} from "../../dist/runtime/handlers.js";
import { useRuntimeWorkers } from "../../dist/runtime/workers.js";
import { once } from "node:events";

const root = process.argv[2];
configureLocal({ id: "probe", endpoint: "http://127.0.0.1:4567", port: 13559 });
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
// Hold startup across the HTTP deadline, then let the real build/worker proceed.
useBus().subscribe("function.invoked", ({ properties }) => {
  const stage = properties.event.pauseStartup;
  if (!stage) return;
  const target =
    stage === "build"
      ? useFunctionBuilder()
      : useRuntimeHandlers().for("nodejs22.x");
  const key = stage === "build" ? "artifact" : "startWorker";
  const original = target[key];
  target[key] = async (...args) => {
    target[key] = original;
    await once(process, "message");
    const result = await original(...args);
    setTimeout(async () => {
      const workers = await useRuntimeWorkers();
      process.send({
        live: !!workers.fromID(properties.workerID),
        request: workers.getCurrentRequestID(properties.workerID),
      });
    }, 250);
    return result;
  };
});
const bridge = await startLocalBridge({
  host: "127.0.0.1",
  port: 0,
  token: process.env.PROBE_TOKEN,
});
console.log(JSON.stringify({ port: bridge.address().port }));

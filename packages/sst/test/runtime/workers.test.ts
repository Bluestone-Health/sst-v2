import { test, expect, vi } from "vitest";
vi.mock("../../dist/logger.js", () => ({ Logger: { debug: vi.fn() } }));
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({
  threads: [] as any[],
  finish: undefined as undefined | (() => void),
}));
vi.mock("worker_threads", () => ({
  Worker: class extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    terminate = vi.fn(async () => {
      this.emit("exit");
      return 0;
    });
    constructor() {
      super();
      state.threads.push(this);
    }
  },
}));
vi.mock("../../dist/project.js", () => ({
  useProject: () => ({ paths: { root: "/tmp" } }),
}));
vi.mock("../../dist/runtime/server.js", () => ({
  useRuntimeServerConfig: async () => ({
    url: "http://localhost",
    API_VERSION: "test",
  }),
}));
vi.mock("../../dist/constructs/Function.js", () => ({
  useFunctions: () => ({ fromID: () => ({ runtime: "nodejs22.x" }) }),
}));
vi.mock("../../dist/watcher.js", () => ({
  useWatcher: () => ({ subscribe: vi.fn() }),
}));
import {
  useFunctionBuilder,
  useRuntimeHandlers,
} from "../../dist/runtime/handlers.js";
import { useRuntimeWorkers } from "../../dist/runtime/workers.js";
import { useBus } from "../../dist/bus.js";

test("overlapping invocations start one worker and keep its registry until exit", async () => {
  const workers = await useRuntimeWorkers();
  const builder = useFunctionBuilder();
  const gate = new Promise<void>((resolve) => {
    state.finish = resolve;
  });
  vi.spyOn(builder, "artifact").mockImplementation(async () => {
    await gate;
    return { out: "out", handler: "handler" };
  });
  const invoked = {
    functionID: "fn",
    workerID: "same",
    requestID: "one",
    env: {},
    event: {},
    context: {},
  } as any;
  useBus().publish("function.invoked", invoked);
  useBus().publish("function.invoked", { ...invoked, requestID: "two" });
  state.finish!();
  await new Promise((resolve) => setImmediate(resolve));
  expect(state.threads.length).toBeGreaterThan(0);
  expect(builder.artifact).toHaveBeenCalledTimes(1);
  expect(state.threads).toHaveLength(1);
  expect(workers.fromID("same")).toMatchObject({ functionID: "fn" });
  await useRuntimeHandlers().for("nodejs22.x").stopWorker("same");
  expect(workers.fromID("same")).toBeUndefined();
});

test("an older Node thread exit cannot erase its replacement", async () => {
  const workers = await useRuntimeWorkers();
  const handler = useRuntimeHandlers().for("nodejs22.x");
  const input = {
    workerID: "replace",
    functionID: "fn",
    out: "out",
    handler: "handler",
    runtime: "nodejs22.x",
    environment: {},
    url: "http://localhost",
  };
  await handler.startWorker(input);
  const older = state.threads.at(-1);
  await handler.startWorker(input);
  const replacement = state.threads.at(-1);
  const exited = vi.spyOn(workers, "exited");
  older.emit("exit");
  expect(exited).not.toHaveBeenCalled();
  await handler.stopWorker("replace");
  expect(replacement.terminate).toHaveBeenCalledTimes(1);
});

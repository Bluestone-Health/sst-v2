import { test, expect, vi } from "vitest";
vi.mock("../../dist/logger.js", () => ({ Logger: { debug: vi.fn() } }));

vi.mock("../../dist/project.js", () => ({ useProject: () => ({}) }));
vi.mock("../../dist/watcher.js", async () => {
  const { useBus } = await import("../../dist/bus.js");
  return {
    useWatcher: () => ({ subscribe: useBus().forward("file.changed") }),
  };
});
vi.mock("../../dist/constructs/Function.js", () => ({
  useFunctions: () => ({ all: { fn: { runtime: "test" } } }),
}));
import {
  useFunctionBuilder,
  useRuntimeHandlers,
} from "../../dist/runtime/handlers.js";
import { useBus } from "../../dist/bus.js";

test("saves during compilation trigger a follow-up build before serving artifacts", async () => {
  const handlers = useRuntimeHandlers();
  let finish!: () => void;
  const build = vi
    .spyOn(handlers, "build")
    .mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { type: "success", handler: "old", out: "out" };
    })
    .mockResolvedValue({ type: "success", handler: "latest", out: "out" });
  handlers.register({
    canHandle: (runtime) => runtime === "test",
    shouldBuild: () => true,
  } as any);
  const builder = useFunctionBuilder();
  const pending = builder.artifact("fn");
  await new Promise((resolve) => setImmediate(resolve));
  expect(build).toHaveBeenCalledTimes(1);
  useBus().publish("file.changed", {
    file: "handler.ts",
    relative: "handler.ts",
  });
  useBus().publish("file.changed", {
    file: "handler.ts",
    relative: "handler.ts",
  });
  finish();
  expect(await pending).toMatchObject({ handler: "latest" });
  expect(build).toHaveBeenCalledTimes(2);
});

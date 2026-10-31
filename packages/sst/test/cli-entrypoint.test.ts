import { expect, test, vi } from "vitest";

vi.mock("../dist/cli/program.js", async () => ({
  ...(await vi.importActual<any>("../dist/cli/program.js")),
  parse: vi.fn(),
}));

test("CLI entrypoint calls the bind-aware parser", async () => {
  const listeners = process.listeners("uncaughtException");
  try {
    await import("../dist/cli/sst.js");
    const { parse } = await import("../dist/cli/program.js");
    expect(parse).toHaveBeenCalledOnce();
  } finally {
    process.removeAllListeners("uncaughtException");
    for (const listener of listeners) process.on("uncaughtException", listener);
  }
});

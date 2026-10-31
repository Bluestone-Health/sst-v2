import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../dist/project.js", () => ({ initProject: vi.fn() }));
vi.mock("../dist/cli/telemetry/telemetry.js", () => ({ trackCli: vi.fn() }));
vi.mock("../dist/local.js", () => ({
  configureLocal: vi.fn(),
  useLocal: () => ({
    id: "review",
    endpoint: "http://127.0.0.1:4567",
    port: 13559,
  }),
}));

beforeEach(() => {
  vi.stubEnv("SST_VERBOSE", process.env.SST_VERBOSE);
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

async function parser() {
  const { program, parse } = await import("../dist/cli/program.js");
  const handler = vi.fn();
  program.command("deploy", "", () => {}, handler);
  program.command("local", "", () => {}, handler);
  // Use the real bind builder, but replace its handler to avoid running a child or AWS.
  const { bind } = await import("../dist/cli/commands/bind.js");
  const command = program.command.bind(program);
  vi.spyOn(program, "command").mockImplementation((...args: any[]) => {
    args[3] = handler;
    return command(...args);
  });
  bind(program);
  return { parse, handler, program };
}

test.each([
  "--env review",
  "--endpoint http://127.0.0.1:4567",
  "--port 13559",
  "--port=13559",
  "--env review --endpoint http://127.0.0.1:4567 --port 13559",
])(
  "rejects deploy with local-only flags %s before project initialization",
  async (flags) => {
    const { parse, handler } = await parser();
    const { initProject } = await import("../dist/project.js");
    await expect(parse(["deploy", ...flags.split(" ")])).rejects.toThrow(
      /require.*--local|sst local/
    );
    expect(initProject).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  }
);

test.each(["bind", "env"])("%s preserves child flags", async (name) => {
  const { parse, handler } = await parser();
  await parse([
    name,
    "node",
    "script.js",
    "--env",
    "production",
    "--endpoint",
    "https://example.com",
    "--port",
    "3000",
    "--local",
  ]);
  expect(handler).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0][0].command).toEqual([
    "node",
    "script.js",
    "--env",
    "production",
    "--endpoint",
    "https://example.com",
    "--port",
    "3000",
    "--local",
  ]);
  const { configureLocal } = await import("../dist/local.js");
  expect(configureLocal).not.toHaveBeenCalled();
});

test.each(["local", "bind"])(
  "%s accepts explicit local configuration",
  async (name) => {
    const { parse, handler } = await parser();
    await parse([
      name,
      ...(name === "bind" ? ["--local"] : []),
      "--env",
      "review",
      "--endpoint",
      "http://127.0.0.1:4567",
      "--port",
      "13559",
      ...(name === "bind" ? ["node", "script.js"] : []),
    ]);
    expect(handler).toHaveBeenCalledOnce();
    const { configureLocal } = await import("../dist/local.js");
    expect(configureLocal).toHaveBeenCalled();
  }
);

test.each(["bind", "env"])(
  "%s keeps multiword child tokens and delimiters with SST options before bind",
  async (name) => {
    const { parse, handler } = await parser();
    const child = ["node", "a script.js", "--stage", "production", "--", "001"];
    await parse(["--stage", "review", name, "--", ...child]);
    expect(handler.mock.calls[0][0].stage).toBe("review");
    expect(handler.mock.calls[0][0].command).toEqual(child);
  }
);

test("local bind keeps colliding child flags separate from its SST flags", async () => {
  const { parse, handler } = await parser();
  const child = [
    "node",
    "script.js",
    "--env",
    "production",
    "--endpoint",
    "https://example.com",
    "--port",
    "3000",
    "--no-local",
  ];
  await parse([
    "bind",
    "--local",
    "--env",
    "review",
    "--endpoint",
    "http://127.0.0.1:4567",
    "--port",
    "13559",
    ...child,
  ]);
  expect(handler.mock.calls[0][0].command).toEqual(child);
  const { configureLocal } = await import("../dist/local.js");
  expect(configureLocal).toHaveBeenCalledWith({
    id: "review",
    endpoint: "http://127.0.0.1:4567",
    port: 13559,
  });
});

test.each([
  ["script", "false"],
  ["script", "true"],
  ["verbose", "false"],
  ["verbose", "true"],
])(
  "bind accepts a separated boolean value --%s %s before the child",
  async (option, value) => {
    const { parse, handler, program } = await parser();
    program.exitProcess(false).fail((message, error) => {
      throw error || new Error(message);
    });
    const child = ["node", "app.js", "--env", "child"];
    await parse(["bind", `--${option}`, value, ...child]);
    expect(handler.mock.calls[0][0][option]).toBe(value === "true");
    expect(handler.mock.calls[0][0].command).toEqual(child);
  }
);

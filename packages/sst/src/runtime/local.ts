import express from "express";
import { randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";
import { useBus } from "../bus.js";
import { useFunctions } from "../constructs/Function.js";
import { useFunctionBuilder, useRuntimeHandlers } from "./handlers.js";
import { startRuntimeServer } from "./server.js";
import type {} from "./runtime.js";
import { useLocal } from "../local.js";

const invocation = z.object({
  functionID: z.string().min(1),
  requestID: z.string().min(1),
  event: z.unknown(),
  deadline: z.number().positive().max(900_000),
  env: z.record(z.string()),
  context: z
    .object({
      awsRequestId: z.string(),
      invokedFunctionArn: z.string(),
      logGroupName: z.string(),
      logStreamName: z.string(),
    })
    .passthrough(),
});

/** Internal transport probe. Run one bridge per SST process/check-out. */
export async function startLocalBridge(options: {
  host: string;
  port: number;
  token: string;
}) {
  if (!options.token || options.token.length < 32)
    throw new Error(
      "The local bridge requires a random token of at least 32 characters."
    );
  const expected = Buffer.from(`Bearer ${options.token}`);
  const runtime = await startRuntimeServer({ host: "127.0.0.1", port: 0 });
  const bus = useBus();
  const builder = useFunctionBuilder();
  const handlers = useRuntimeHandlers();
  const app = express();
  app.use((req, res, next) => {
    const provided = Buffer.from(req.headers.authorization || "");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      res.status(401).json({ errorMessage: "Invalid local bridge token" });
      return;
    }
    next();
  });
  app.post("/invoke", express.json({ limit: "6mb" }), async (req, res) => {
    const parsed = invocation.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ errorMessage: "Invalid local invocation" });
      return;
    }
    const input = parsed.data;
    const props = useFunctions().fromID(input.functionID);
    if (!props?.runtime?.startsWith("nodejs")) {
      res
        .status(400)
        .json({
          errorMessage: "Local mode requires a registered Node.js function",
        });
      return;
    }
    const workerID = randomUUID();
    const deadline = Date.now() + input.deadline;
    const handler = handlers.for(props.runtime);
    const controller = new AbortController();
    let finished = false;
    const matches = (evt: {
      properties: { workerID: string; requestID: string };
    }) =>
      evt.properties.workerID === workerID &&
      evt.properties.requestID === input.requestID;
    const subscriptions = [
      bus.subscribe("function.success", (evt) => {
        if (matches(evt)) void finish(200, evt.properties.body ?? null);
      }),
      bus.subscribe("function.error", (evt) => {
        if (matches(evt)) void finish(502, evt.properties);
      }),
      bus.subscribe("worker.exited", (evt) => {
        if (evt.properties.workerID === workerID)
          void finish(502, {
            errorType: "WorkerExited",
            errorMessage: "Local worker exited before returning a result",
          });
      }),
    ];
    const timer = setTimeout(
      () =>
        void finish(504, {
          errorType: "TimeoutError",
          errorMessage: "Local invocation timed out",
        }),
      input.deadline
    );
    res.once(
      "close",
      () => void finish(502, { errorMessage: "Invocation disconnected" })
    );

    async function finish(status: number, body: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subscriptions.forEach((sub) => bus.unsubscribe(sub));
      controller.abort();
      await handler.stopWorker(workerID);
      if (!res.destroyed) res.status(status).json(body);
    }

    try {
      const artifact = await builder.artifact(input.functionID);
      if (finished) return;
      if (!artifact) {
        await finish(502, {
          errorType: "BuildError",
          errorMessage: "Local handler failed to build; check SST logs",
        });
        return;
      }
      // ponytail: a fresh worker per request isolates env/global state; pool only if measurements justify it.
      const { SST_LOCAL_BRIDGE_TOKEN: _token, ...env } = input.env;
      if (useLocal()) {
        for (const key of Object.keys(env)) {
          if (
            key.startsWith("AWS_ENDPOINT_URL") ||
            key === "AWS_SESSION_TOKEN" ||
            key === "AWS_PROFILE"
          )
            delete env[key];
          // CloudFormation creates queues through LocalStack's internal port.
          if (key.startsWith("SST_Queue_queueUrl_"))
            env[key] = useLocal()!.endpoint + new URL(env[key]).pathname;
        }
        Object.assign(env, {
          AWS_ENDPOINT_URL: useLocal()!.endpoint,
          AWS_ACCESS_KEY_ID: "test",
          AWS_SECRET_ACCESS_KEY: "test",
          AWS_EC2_METADATA_DISABLED: "true",
        });
      }
      bus.publish("function.invoked", {
        ...input,
        signal: controller.signal,
        event: input.event,
        workerID,
        env,
        context: { ...input.context, awsRequestId: input.requestID },
        deadline: Math.max(1, deadline - Date.now()),
      });
    } catch (error) {
      await finish(502, {
        errorType: "InvocationError",
        errorMessage: String(error),
      });
    }
  });
  return await new Promise<import("http").Server>((resolve, reject) => {
    const server = app.listen(options.port, options.host, () =>
      resolve(server)
    );
    server.once("error", (error) => {
      runtime.close();
      reject(error);
    });
    server.once("close", () => runtime.close());
  });
}

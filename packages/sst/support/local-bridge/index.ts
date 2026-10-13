import type { Context } from "aws-lambda";

// This module must not import the AWS IoT Live Lambda bridge.
export async function handler(event: unknown, context: Context) {
  const endpoint = process.env.SST_LOCAL_BRIDGE_URL;
  const token = process.env.SST_LOCAL_BRIDGE_TOKEN;
  if (!endpoint || !token) throw new Error("Local bridge URL/token is missing");
  const deadline = context.getRemainingTimeInMillis();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        ![
          "SST_LOCAL_BRIDGE_TOKEN",
          "LOCALSTACK_AUTH_TOKEN",
          "AWS_LAMBDA_RUNTIME_API",
          "LAMBDA_TASK_ROOT",
          "LAMBDA_RUNTIME_DIR",
          "NODE_OPTIONS",
          "NODE_PATH",
          "PATH",
          "LD_LIBRARY_PATH",
        ].includes(key)
    )
  );
  const response = await fetch(`${endpoint}/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      functionID: process.env.SST_FUNCTION_ID,
      requestID: context.awsRequestId,
      event,
      context,
      deadline,
      env,
    }),
    signal: AbortSignal.timeout(Math.max(1, deadline - 100)),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      result.errorMessage || `Local bridge failed (${response.status})`
    );
    error.name = result.errorType || "LocalInvocationError";
    throw error;
  }
  return result;
}

import { VisibleError } from "./error.js";

interface LocalOptions {
  id: string;
  endpoint: string;
  port: number;
  token?: string;
}
let local: LocalOptions | undefined;
export const useLocal = () => local;

export function configureLocal(options: LocalOptions) {
  const endpoint = new URL(options.endpoint);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(options.id))
    throw new VisibleError(
      "Local environment ID must start with a lowercase letter and contain at most 32 letters, digits, or hyphens."
    );
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.username ||
    endpoint.password
  )
    throw new VisibleError(
      "Local mode requires an http://127.0.0.1:<port> LocalStack endpoint."
    );
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw new VisibleError(
      "Choose a local bridge port between 1024 and 65535."
    );
  local = { ...options, endpoint: endpoint.origin };
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("AWS_ENDPOINT_URL") ||
      [
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_SESSION_TOKEN",
        "AWS_ROLE_ARN",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      ].includes(key)
    )
      delete process.env[key];
  }
  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "false",
    AWS_ENDPOINT_URL: endpoint.origin,
    AWS_ENDPOINT_URL_S3: `http://s3.localhost.localstack.cloud:${
      endpoint.port || "80"
    }`,
    SST_TELEMETRY_DISABLED: "1",
  });
}

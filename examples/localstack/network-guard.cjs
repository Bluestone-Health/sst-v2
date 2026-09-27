// Verification-only: fail any Node HTTP/SDK/fetch request outside this machine.
const fs = require("node:fs");
function check(url) {
  const host = url.hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "host.docker.internal"].includes(host) && !host.endsWith(".localhost.localstack.cloud"))
    throw new Error(`Local verification blocked outbound request to ${host}`);
  if (process.env.SST_LOCAL_NETWORK_LOG) fs.appendFileSync(process.env.SST_LOCAL_NETWORK_LOG, `${url.origin}\n`);
}
for (const protocol of ["http", "https"]) {
  const module = require(`node:${protocol}`);
  const request = module.request;
  module.request = function (input, ...args) {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(`${protocol}://${input.hostname || input.host || "localhost"}${input.port ? `:${input.port}` : ""}`);
    check(url);
    return request.call(this, input, ...args);
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = function (input, ...args) { check(new URL(typeof input === "string" || input instanceof URL ? input : input.url)); return fetch.call(this, input, ...args); };

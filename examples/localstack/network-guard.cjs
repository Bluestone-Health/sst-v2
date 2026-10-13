// Verification-only: fail any Node HTTP/SDK/fetch request outside this machine.
const fs = require("node:fs");
const { urlToHttpOptions } = require("node:url");
function check(url) {
  const host = url.hostname;
  if (
    !["127.0.0.1", "localhost", "[::1]", "host.docker.internal"].includes(
      host
    ) &&
    !host.endsWith(".localhost.localstack.cloud")
  )
    throw new Error(`Local verification blocked outbound request to ${host}`);
  if (process.env.SST_LOCAL_NETWORK_LOG)
    fs.appendFileSync(process.env.SST_LOCAL_NETWORK_LOG, `${url.origin}\n`);
}
for (const protocol of ["http", "https"]) {
  const module = require(`node:${protocol}`);
  const request = module.request;
  module.request = function (input, ...args) {
    const options = {
      ...(typeof input === "string" || input instanceof URL
        ? urlToHttpOptions(new URL(input))
        : input),
      ...(typeof args[0] === "object" ? args[0] : {}),
    };
    const host = options.hostname || options.host || "localhost";
    check(
      new URL(
        `${protocol}://${
          host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
        }${options.port ? `:${options.port}` : ""}`
      )
    );
    return request.call(this, input, ...args);
  };
  module.get = function (...args) {
    const req = module.request(...args);
    req.end();
    return req;
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = function (input, ...args) {
  check(
    new URL(
      typeof input === "string" || input instanceof URL ? input : input.url
    )
  );
  // Verification rejects redirects so a local response cannot send fetch off-host.
  return fetch.call(this, input, { ...args[0], redirect: "error" });
};

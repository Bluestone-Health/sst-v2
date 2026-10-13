import { test, expect } from "vitest";
import { configureLocal, useLocal } from "../dist/local.js";

test("local mode is explicit and rejects cloud endpoints and unsafe environment IDs", () => {
  expect(useLocal()).toBeUndefined();
  expect(() =>
    configureLocal({
      id: "../prod",
      endpoint: "http://127.0.0.1:4567",
      port: 13557,
    })
  ).toThrow();
  expect(() =>
    configureLocal({ id: "a", endpoint: "https://aws.amazon.com", port: 13557 })
  ).toThrow();
  process.env.AWS_ACCESS_KEY_ID = "real-credential-must-not-survive";
  process.env.AWS_SESSION_TOKEN = "real-token-must-not-survive";
  process.env.AWS_ENDPOINT_URL_S3 = "https://s3.amazonaws.com";
  configureLocal({ id: "a", endpoint: "http://127.0.0.1:4567", port: 13557 });
  expect(process.env.AWS_ACCESS_KEY_ID).toBe("test");
  expect(process.env.AWS_SESSION_TOKEN).toBeUndefined();
  expect(process.env.AWS_ENDPOINT_URL_S3).toBe(
    "http://s3.localhost.localstack.cloud:4567"
  );
  expect(useLocal()?.id).toBe("a");
});

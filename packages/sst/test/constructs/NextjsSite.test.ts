import * as fs from "fs";
import * as path from "path";
import { test, expect, beforeAll, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import {
  countResources,
  countResourcesLike,
  hasResource,
  objectLike,
  arrayWith,
  printResource,
  ANY,
  ABSENT,
  createApp,
} from "./helper.js";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import { Stack, NextjsSite, NextjsSiteProps } from "../../dist/constructs";

const sitePath = "test/constructs/nextjs-site";
const serverFunctionsPath = path.join(
  sitePath,
  ".open-next",
  "server-functions"
);
const pnpmPath = path.join(
  serverFunctionsPath,
  "default",
  "node_modules",
  ".pnpm"
);
const serverFunctionPnpmPath = path.join(
  sitePath,
  ".open-next",
  "server-function",
  "node_modules",
  ".pnpm"
);

function createPnpmPackageDir(name: string, root = pnpmPath) {
  const pkgPath = path.join(root, name);
  fs.mkdirSync(pkgPath, { recursive: true });
  fs.writeFileSync(path.join(pkgPath, "marker.txt"), "test");
  return pkgPath;
}

function removePnpmPackageDir(name: string) {
  fs.rmSync(path.join(pnpmPath, name), { recursive: true, force: true });
  fs.rmSync(path.join(serverFunctionPnpmPath, name), {
    recursive: true,
    force: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  [
    "tailwindcss@0.0.0-sst-default",
    "sst-test-keep@1.0.0",
    "tailwindcss@0.0.0-sst-disabled",
    "sst-custom-clean@1.0.0",
    "tailwindcss@0.0.0-sst-custom",
    "tailwindcss@0.0.0-sst-hook",
    "sst-hook-keep@1.0.0",
    "tailwindcss@0.0.0-sst-single",
    "sst-single-keep@1.0.0",
  ].forEach(removePnpmPackageDir);
});

beforeAll(async () => {
  // Set `SKIP_BUILD` to iterate faster on tests in vitest watch mode;
  if (
    process.env.SKIP_BUILD &&
    fs.existsSync(path.join(sitePath, "node_modules"))
  ) {
    return;
  }

  // Install Next.js app dependencies
  execSync("npm install", {
    cwd: sitePath,
    stdio: "inherit",
  });
  // Build Next.js app
  execSync("npx --yes open-next@latest build", {
    cwd: sitePath,
    stdio: "inherit",
  });
});

async function createSite(
  props?: NextjsSiteProps | ((stack: Stack) => NextjsSiteProps)
) {
  const app = await createApp();
  const stack = new Stack(app, "stack");
  const site = new NextjsSite(stack, "Site", {
    path: sitePath,
    buildCommand: "echo skip",
    ...(typeof props === "function" ? props(stack) : props),
  });
  await app.finish();
  return { app, stack, site };
}

/////////////////////////////
// Test Constructor
/////////////////////////////

test("default", async () => {
  const { stack, site } = await createSite();
  expect(site.url).toBeDefined();
  expect(site.customDomainUrl).toBeUndefined();
  expect(site.cdk?.bucket.bucketArn).toBeDefined();
  expect(site.cdk?.bucket.bucketName).toBeDefined();
  expect(site.cdk?.distribution.distributionId).toBeDefined();
  expect(site.cdk?.distribution.distributionDomainName).toBeDefined();
  expect(site.cdk?.certificate).toBeUndefined();
  countResources(stack, "AWS::S3::Bucket", 1);
  hasResource(stack, "AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test("default: check cache policy configured correctly", async () => {
  const { stack, site } = await createSite();
  countResources(stack, "AWS::CloudFront::CachePolicy", 1);
  hasResource(stack, "AWS::CloudFront::CachePolicy", {
    CachePolicyConfig: objectLike({
      ParametersInCacheKeyAndForwardedToOrigin: objectLike({
        HeadersConfig: objectLike({
          Headers: arrayWith(["x-open-next-cache-key"]),
        }),
      }),
    }),
  });
});

test("timeout defined", async () => {
  const { stack } = await createSite({
    timeout: 100,
  });
  hasResource(stack, "AWS::CloudFront::Distribution", {
    DistributionConfig: objectLike({
      Origins: arrayWith([
        objectLike({
          CustomOriginConfig: objectLike({
            OriginReadTimeout: 100,
          }),
        }),
      ]),
    }),
  });
});

test("cdk.distribution.defaultBehavior", async () => {
  const { stack, site } = await createSite({
    cdk: {
      distribution: {
        defaultBehavior: {
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    },
  });
  hasResource(stack, "AWS::CloudFront::Distribution", {
    DistributionConfig: objectLike({
      DefaultCacheBehavior: objectLike({
        ViewerProtocolPolicy: "https-only",
      }),
    }),
  });
});

test("cdk.revalidation.vpc: not set", async () => {
  const { stack } = await createSite();
  hasResource(stack, "AWS::Lambda::Function", {
    Description: "Next.js revalidator",
    VpcConfig: ABSENT,
  });
});

test("cdk.revalidation.vpc: set", async () => {
  const { stack } = await createSite((stack) => ({
    cdk: {
      revalidation: {
        vpc: new Vpc(stack, "Vpc"),
      },
    },
  }));
  hasResource(stack, "AWS::Lambda::Function", {
    Description: "Next.js revalidator",
    VpcConfig: ANY,
  });
});

test("buildCloudWatchRouteName", async () => {
  expect(NextjsSite._test.buildCloudWatchRouteName("/api")).toEqual("/api");
  expect(NextjsSite._test.buildCloudWatchRouteName("/api/[id]")).toEqual(
    "/api/id"
  );
});

test("bundleCleanup: default removes matched packages", async () => {
  const removedPkg = "tailwindcss@0.0.0-sst-default";
  const keptPkg = "sst-test-keep@1.0.0";
  const removedPath = createPnpmPackageDir(removedPkg);
  const keptPath = createPnpmPackageDir(keptPkg);

  await createSite();

  expect(fs.existsSync(removedPath)).toBeFalsy();
  expect(fs.existsSync(keptPath)).toBeTruthy();
});

test("bundleCleanup: default removes matched packages from server-function output", async () => {
  const removedPkg = "tailwindcss@0.0.0-sst-single";
  const keptPkg = "sst-single-keep@1.0.0";
  const removedPath = createPnpmPackageDir(removedPkg, serverFunctionPnpmPath);
  const keptPath = createPnpmPackageDir(keptPkg, serverFunctionPnpmPath);

  await createSite();

  expect(fs.existsSync(removedPath)).toBeFalsy();
  expect(fs.existsSync(keptPath)).toBeTruthy();
});

test("bundleCleanup: false disables cleanup", async () => {
  const pkgName = "tailwindcss@0.0.0-sst-disabled";
  const pkgPath = createPnpmPackageDir(pkgName);

  await createSite({
    bundleCleanup: false,
  });

  expect(fs.existsSync(pkgPath)).toBeTruthy();
});

test("bundleCleanup: custom list overrides defaults", async () => {
  const removedPkg = "sst-custom-clean@1.0.0";
  const keptPkg = "tailwindcss@0.0.0-sst-custom";
  const removedPath = createPnpmPackageDir(removedPkg);
  const keptPath = createPnpmPackageDir(keptPkg);

  await createSite({
    bundleCleanup: ["sst-custom-clean"],
  });

  expect(fs.existsSync(removedPath)).toBeFalsy();
  expect(fs.existsSync(keptPath)).toBeTruthy();
});

test("afterBuild: receives cleanup summary", async () => {
  const removedPkg = "tailwindcss@0.0.0-sst-hook";
  const keptPkg = "sst-hook-keep@1.0.0";
  createPnpmPackageDir(removedPkg);
  createPnpmPackageDir(keptPkg);

  let hookInput:
    | {
        sitePath: string;
        openNextPath: string;
        removedPackages: string[];
        bytesRemoved: number;
      }
    | undefined;

  await createSite({
    afterBuild: (input) => {
      hookInput = input;
    },
  });

  expect(hookInput).toBeDefined();
  expect(hookInput?.sitePath).toEqual(sitePath);
  expect(hookInput?.openNextPath).toEqual(path.join(sitePath, ".open-next"));
  expect(hookInput?.removedPackages).toContain(removedPkg);
  expect(hookInput?.removedPackages).not.toContain(keptPkg);
  expect(hookInput?.bytesRemoved).toBeGreaterThan(0);
});

test("bundleCleanup: no-op when no packages match", async () => {
  let hookInput:
    | {
        removedPackages: string[];
        bytesRemoved: number;
      }
    | undefined;
  await createSite({
    bundleCleanup: ["sst-test-package-that-does-not-exist"],
    afterBuild: (input) => {
      hookInput = {
        removedPackages: input.removedPackages,
        bytesRemoved: input.bytesRemoved,
      };
    },
  });

  expect(hookInput).toBeDefined();
  expect(hookInput?.removedPackages).toEqual([]);
  expect(hookInput?.bytesRemoved).toEqual(0);
});

test("afterBuild: preserves thrown error details", async () => {
  await expect(
    createSite({
      afterBuild: () => {
        throw new Error("afterBuild exploded");
      },
    })
  ).rejects.toThrow(/afterBuild exploded/);
});

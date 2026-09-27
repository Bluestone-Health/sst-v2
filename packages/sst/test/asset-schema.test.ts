import { test, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { AssetManifest } from "cdk-assets";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("the embedded asset publisher reads the installed CDK's manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sst-assets-"));
  try {
    await writeFile(path.join(root, "asset.txt"), "asset");
    const app = new App({ outdir: path.join(root, "out") });
    const stack = new Stack(app, "Example");
    new Asset(stack, "Asset", { path: path.join(root, "asset.txt") });
    const assembly = app.synth();
    const manifest = assembly.artifacts.find(
      (artifact) => artifact.id === "Example.assets"
    )!;
    const assets = AssetManifest.fromFile((manifest as any).file);
    expect(assets.entries.length).toBeGreaterThan(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { test, expect } from "vitest";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DynamicFileMigrationProvider } from "../dist/support/rds-migrator/index.mjs";

test("invalid local migrations fail and remove their temporary copy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sst-migration-"));
  try {
    await writeFile(path.join(root, "001-invalid.mjs"), "export const up = ;");
    await expect(
      new DynamicFileMigrationProvider(root).getMigrations()
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(["001-invalid.mjs"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

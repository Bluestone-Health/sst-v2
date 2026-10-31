import { test, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { acquireSessionLock } from "../../dist/util/session-lock.js";

for (const content of ["", " \n\t", "garbage", "0", "-1"]) {
  test(`malformed owner ${JSON.stringify(
    content
  )} fails closed without signaling`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
    const lock = path.join(root, "session.lock");
    const kill = vi.spyOn(process, "kill");
    try {
      await fs.writeFile(lock, content);
      await expect(acquireSessionLock(lock, "test")).rejects.toThrow(
        /invalid|incomplete/i
      );
      expect(kill).not.toHaveBeenCalled();
      expect(await fs.readFile(lock, "utf8")).toBe(content);
    } finally {
      kill.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test("concurrent dead-owner takeover grants one owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  try {
    await fs.writeFile(lock, "2147483647");
    const results = await Promise.allSettled(
      Array.from({ length: 32 }, () => acquireSessionLock(lock, "test"))
    );
    const acquired = results.filter((result) => result.status === "fulfilled");
    expect(acquired).toHaveLength(1);
    expect(await fs.readFile(lock, "utf8")).toBe(String(process.pid));
    for (const result of acquired)
      if (result.status === "fulfilled") await result.value();
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("abandoned takeover guard fails closed and explains manual recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  try {
    await fs.writeFile(lock, "2147483647");
    await fs.mkdir(lock + ".reclaim");
    await expect(acquireSessionLock(lock, "test")).rejects.toThrow(
      /confirm.*running.*remov/i
    );
    expect(await fs.readFile(lock, "utf8")).toBe("2147483647");
    expect((await fs.stat(lock + ".reclaim")).isDirectory()).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("release only removes the inode this session owns", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  try {
    const release = await acquireSessionLock(lock, "test");
    await fs.rename(lock, lock + ".old");
    await fs.writeFile(lock, String(process.pid));
    await release();
    expect(await fs.readFile(lock, "utf8")).toBe(String(process.pid));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an interrupted temporary write never publishes a partial lock", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  const open = fs.open.bind(fs);
  const mocked = vi
    .spyOn(fs, "open")
    .mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      handle.writeFile = async () => {
        throw new Error("interrupted initialization");
      };
      return handle;
    });
  try {
    await expect(acquireSessionLock(lock, "test")).rejects.toThrow(
      "interrupted initialization"
    );
    expect(await fs.readdir(root)).toEqual([]);
    const release = await acquireSessionLock(lock, "test");
    await release();
  } finally {
    mocked.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a paused initializer cannot overwrite a fully published live owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  let finish!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const open = fs.open.bind(fs);
  const mocked = vi
    .spyOn(fs, "open")
    .mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (...input) => {
        entered();
        await gate;
        return write(...input);
      };
      return handle;
    });
  try {
    const pending = acquireSessionLock(lock, "test");
    await writing;
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
    const release = await acquireSessionLock(lock, "test");
    finish();
    await expect(pending).rejects.toThrow(/already running/);
    expect(await fs.readFile(lock, "utf8")).toBe(String(process.pid));
    await release();
  } finally {
    finish();
    mocked.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("concurrent shutdown cannot remove a replacement session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sst-lock-"));
  const lock = path.join(root, "session.lock");
  let stat;
  let remove;
  try {
    const release = await acquireSessionLock(lock, "test");
    const identity = await fs.stat(lock);
    stat = vi.spyOn(fs, "stat").mockResolvedValue(identity);
    const unlink = fs.unlink.bind(fs);
    let replaced = false;
    remove = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      await unlink(file);
      if (!replaced) {
        replaced = true;
        await fs.writeFile(lock, "replacement");
      }
    });
    await Promise.all([release(), release()]);
    expect(await fs.readFile(lock, "utf8")).toBe("replacement");
  } finally {
    stat?.mockRestore();
    remove?.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

import fs from "fs/promises";
import { randomUUID } from "crypto";

export async function acquireSessionLock(lock: string, environment: string) {
  const temporary = `${lock}.${process.pid}.${randomUUID()}`;
  const reclaim = `${lock}.reclaim`;
  async function stale() {
    try {
      const contents = (await fs.readFile(lock, "utf8")).trim();
      const owner = Number(contents);
      if (!/^\d+$/.test(contents) || !Number.isSafeInteger(owner) || owner <= 0)
        throw new Error(
          `Local session lock ${lock} has an invalid or incomplete PID. Confirm no session is running before removing it.`
        );
      try {
        process.kill(owner, 0);
      } catch (error: any) {
        if (error.code === "ESRCH") return;
        throw error;
      }
      throw new Error(
        `Local environment ${environment} is already running (PID ${owner}).`
      );
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(String(process.pid));
    } finally {
      await handle.close();
    }
    const identity = await fs.stat(temporary);
    try {
      await fs.mkdir(reclaim, { mode: 0o700 });
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      throw new Error(
        `Local session takeover is in progress or was interrupted. Confirm no session is running before removing ${reclaim}.`
      );
    }
    try {
      await stale();
      await fs.rm(lock, { force: true });
      // Publish only a fully written inode; readers never see an initializing PID.
      await fs.link(temporary, lock);
    } finally {
      // shortcut: a crash leaves this guard; operator confirmation is required to recover it.
      await fs.rmdir(reclaim);
    }
    let releasing: Promise<void> | undefined;
    return () =>
      (releasing ||= (async () => {
        const current = await fs.stat(lock).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        if (current?.ino === identity.ino && current.dev === identity.dev)
          await fs.unlink(lock);
      })());
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

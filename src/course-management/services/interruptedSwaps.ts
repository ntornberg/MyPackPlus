import { AppLogger } from "../../utils/logger";
import { isLockHeld, withLock } from "../../utils/webLocks";
import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";

import { courseLockName } from "./cartLock";
import type { CartSettings } from "./cartRows";

/**
 * A lab change removes the course before adding it back, so closing or
 * leaving the page between the two leaves the course out of the cart. Each
 * change is written here before its remove and cleared when it finishes;
 * one left behind with nobody holding its course was interrupted.
 */
const STORAGE_KEY = "mypack.interruptedSwaps";
const RECORDS_LOCK = "mypack-interrupted-swaps";

export type SwapRecord = {
  id: string;
  /** The course lock the change held (see cartLock). */
  lockKey: string | null;
  /** "PY 205 (001)" */
  label: string;
  lecture: ModifiedSection;
  /** The lab to put back, with the exact payload that restores it. */
  fromLab: ModifiedSection;
  restorePayload: ToCartPayload;
  settings?: CartSettings;
  startedAt: number;
};

/** Without a course lock to check, assume a change this old is gone. */
const UNLOCKED_STALE_MS = 2 * 60 * 1000;

function storage(): chrome.storage.LocalStorageArea | null {
  try {
    return typeof chrome !== "undefined" && chrome.storage?.local
      ? chrome.storage.local
      : null;
  } catch {
    return null;
  }
}

async function readAll(): Promise<Record<string, SwapRecord>> {
  const area = storage();
  if (!area) return {};
  const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY];
  return stored && typeof stored === "object"
    ? (stored as Record<string, SwapRecord>)
    : {};
}

async function writeAll(records: Record<string, SwapRecord>): Promise<void> {
  await storage()?.set({ [STORAGE_KEY]: records });
}

/** Records a lab change about to remove its course; returns its id. */
export async function beginSwap(
  record: Omit<SwapRecord, "id" | "startedAt">,
): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await withLock(RECORDS_LOCK, async () => {
      const records = await readAll();
      records[id] = { ...record, id, startedAt: Date.now() };
      await writeAll(records);
    });
  } catch (error) {
    AppLogger.warn("Couldn't record the lab change in progress", error);
  }
  return id;
}

/** Forgets a lab change that finished, or one the student has dealt with. */
export async function endSwap(id: string): Promise<void> {
  try {
    await withLock(RECORDS_LOCK, async () => {
      const records = await readAll();
      if (id in records) {
        delete records[id];
        await writeAll(records);
      }
    });
  } catch (error) {
    AppLogger.warn("Couldn't clear the finished lab change", error);
  }
}

/** Lab changes that stopped between removing the course and adding it back. */
export async function interruptedSwaps(): Promise<SwapRecord[]> {
  try {
    const records = Object.values(await readAll());
    const running = await Promise.all(
      records.map((record) =>
        record.lockKey
          ? isLockHeld(courseLockName(record.lockKey))
          : Promise.resolve(Date.now() - record.startedAt < UNLOCKED_STALE_MS),
      ),
    );
    return records.filter((_, index) => !running[index]);
  } catch (error) {
    AppLogger.warn("Couldn't check for interrupted lab changes", error);
    return [];
  }
}

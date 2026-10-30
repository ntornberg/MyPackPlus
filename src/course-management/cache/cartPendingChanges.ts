import { AppLogger } from "../../utils/logger";
import { withLock } from "../../utils/webLocks";

/**
 * Cart changes the extension made that MyPack's captured cart responses may
 * not show yet. A refresh requested before a change can arrive after it and
 * would otherwise replace the cached cart with the older list, dropping a
 * section just added or bringing back one just removed.
 *
 * Each change stays pending until a snapshot settles it: one requested after
 * the change, or one that already shows it. Unsettled changes give way to
 * MyPack after {@link PENDING_TTL_MS}.
 */
const STORAGE_KEY = "mypack.cartPendingChanges";
const JOURNAL_LOCK = "mypack-cart-pending";
export const PENDING_TTL_MS = 2 * 60 * 1000;

type Row = Record<string, unknown>;
type Pending = {
  /** Cart rows added here, by their cache key. */
  added: Record<string, { row: Row; at: number }>;
  /** Removed enrollment classes, with the meetings that left the calendar. */
  removed: Record<string, { classNumbers: string[]; at: number }>;
};

const text = (value: unknown): string | null =>
  value == null || String(value).trim() === "" ? null : String(value).trim();

const enrollOf = (row: Row): string | null =>
  text(row.enroll_class_nbr ?? row.class_nbr);

function classNumbersOf(row: Row): string[] {
  const details = Array.isArray(row.section_details)
    ? (row.section_details as Row[])
    : [];
  return [
    row.enroll_class_nbr,
    row.class_nbr,
    ...details.map((d) => d?.class_nbr),
  ]
    .map(text)
    .filter((value): value is string => value !== null);
}

function storage(): chrome.storage.LocalStorageArea | null {
  try {
    return typeof chrome !== "undefined" && chrome.storage?.local
      ? chrome.storage.local
      : null;
  } catch {
    return null;
  }
}

/** Reads, updates and saves the journal under one lock for every frame. */
function update<T>(change: (pending: Pending, now: number) => T): Promise<T> {
  return withLock(JOURNAL_LOCK, async () => {
    const area = storage();
    const now = Date.now();
    const stored = area
      ? ((await area.get(STORAGE_KEY))[STORAGE_KEY] as Pending | undefined)
      : undefined;
    const pending: Pending = {
      added: { ...stored?.added },
      removed: { ...stored?.removed },
    };
    for (const group of [pending.added, pending.removed]) {
      for (const [key, entry] of Object.entries(group)) {
        if (now - entry.at > PENDING_TTL_MS) delete group[key];
      }
    }
    const result = change(pending, now);
    if (area) {
      await area.set({ [STORAGE_KEY]: pending });
    }
    return result;
  });
}

async function safely(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    // Losing the journal only brings back the stale-refresh window.
    AppLogger.warn("Couldn't record a pending cart change", error);
  }
}

/** Notes a row this extension just added to the cart. */
export function recordCartAdd(hash: string, row: Row): Promise<void> {
  return safely(() =>
    update((pending, now) => {
      pending.added[hash] = { row, at: now };
      const enroll = enrollOf(row);
      if (enroll) delete pending.removed[enroll];
    }),
  );
}

/** Notes an enrollment class this extension just removed from the cart. */
export function recordCartRemove(
  enroll: string,
  classNumbers: string[],
): Promise<void> {
  return safely(() =>
    update((pending, now) => {
      pending.removed[enroll] = { classNumbers, at: now };
      for (const [hash, { row }] of Object.entries(pending.added)) {
        if (enrollOf(row) === enroll) delete pending.added[hash];
      }
    }),
  );
}

/** Drops changes a snapshot requested after them already reflects. */
function settleByTime(pending: Pending, requestedAt: number | undefined) {
  if (requestedAt === undefined) return;
  for (const group of [pending.added, pending.removed]) {
    for (const [key, entry] of Object.entries(group)) {
      if (entry.at < requestedAt) delete group[key];
    }
  }
}

/**
 * The cart table to store for a captured snapshot: its rows, without classes
 * removed here since, plus rows added here since.
 */
export function mergeCartTableSnapshot(
  entries: Record<string, unknown>,
  requestedAt?: number,
): Promise<Record<string, unknown>> {
  return update((pending) => {
    settleByTime(pending, requestedAt);
    const rows = Object.values(entries).filter(
      (row): row is Row => Boolean(row) && typeof row === "object",
    );
    // A snapshot already showing a change settles it, whenever it was asked for.
    for (const [hash, { row }] of Object.entries(pending.added)) {
      const wanted = classNumbersOf(row);
      const shown = rows.some((other) => {
        const listed = classNumbersOf(other);
        return (
          enrollOf(other) === enrollOf(row) &&
          wanted.every((n) => listed.includes(n))
        );
      });
      if (shown) delete pending.added[hash];
    }
    for (const enroll of Object.keys(pending.removed)) {
      if (!rows.some((row) => enrollOf(row) === enroll)) {
        delete pending.removed[enroll];
      }
    }

    // A cart has one row per enrollment class, so a pending row replaces
    // the snapshot's (e.g. the lecture with its old lab).
    const superseded = new Set([
      ...Object.keys(pending.removed),
      ...Object.values(pending.added).map(({ row }) => enrollOf(row)),
    ]);
    const merged = Object.fromEntries(
      Object.entries(entries).filter(([, row]) => {
        const enroll =
          row && typeof row === "object" ? enrollOf(row as Row) : null;
        return !(enroll && superseded.has(enroll));
      }),
    );
    for (const [hash, { row }] of Object.entries(pending.added)) {
      merged[hash] = row;
    }
    return merged;
  }).catch((error: unknown) => {
    AppLogger.warn("Couldn't apply pending cart changes", error);
    return entries;
  });
}

/** A captured cart calendar without meetings of classes removed here since. */
export function filterCartCalendarSnapshot(
  entries: Record<string, unknown>,
  requestedAt?: number,
): Promise<Record<string, unknown>> {
  // Only the cart table settles changes: the two refresh responses arrive in
  // either order, and a stale table must still find what it needs to drop.
  return update((pending) => {
    const gone = new Set(
      Object.values(pending.removed)
        .filter((entry) => requestedAt === undefined || entry.at >= requestedAt)
        .flatMap((entry) => entry.classNumbers),
    );
    if (gone.size === 0) return entries;
    return Object.fromEntries(
      Object.entries(entries).filter(([, event]) => {
        const number =
          event && typeof event === "object"
            ? text((event as Row).class_nbr)
            : null;
        return !(number && gone.has(number));
      }),
    );
  }).catch((error: unknown) => {
    AppLogger.warn("Couldn't apply pending cart changes", error);
    return entries;
  });
}

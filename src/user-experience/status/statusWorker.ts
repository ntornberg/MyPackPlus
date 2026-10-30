export const STATUS_WORKER_ORIGIN =
  "https://mypackext-status-worker.nicktornberg12.workers.dev";

export type StatusLevel = "ok" | "info" | "warning" | "error" | "maintenance";

export type StatusWorkerStatus = {
  ok: boolean;
  level: StatusLevel;
  message: string;
  details?: string;
  updatedAt: string;
  /** Newest version on the Web Store, set from the worker's admin page. */
  latestVersion?: string;
  releaseNotes?: string;
};

const STATUS_ENDPOINT = `${STATUS_WORKER_ORIGIN}/status/simple`;
const STATUS_REQUEST_TIMEOUT_MS = 5000;
const STATUS_FETCH_MESSAGE_TYPE = "status_worker_fetch";

type StatusWorkerFetchResponse = {
  success: boolean;
  status?: unknown;
  error?: string;
};

export function currentVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

/** Compares dotted Chrome versions numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** True only when both versions are well formed and running is older. */
export function isOutdated(
  running: string,
  latest: string | undefined,
): boolean {
  return (
    VERSION_PATTERN.test(running) &&
    latest !== undefined &&
    VERSION_PATTERN.test(latest) &&
    compareVersions(running, latest) < 0
  );
}

/** The status URL, tagged with the running extension's version when known. */
export function statusEndpointUrl(): string {
  const version = currentVersion();
  return version
    ? `${STATUS_ENDPOINT}?version=${encodeURIComponent(version)}`
    : STATUS_ENDPOINT;
}

function isStatusLevel(value: unknown): value is StatusLevel {
  return (
    value === "ok" ||
    value === "info" ||
    value === "warning" ||
    value === "error" ||
    value === "maintenance"
  );
}

function parseStatusWorkerStatus(value: unknown): StatusWorkerStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.ok !== "boolean" ||
    !isStatusLevel(candidate.level) ||
    typeof candidate.message !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    ok: candidate.ok,
    level: candidate.level,
    message: candidate.message,
    details:
      typeof candidate.details === "string" ? candidate.details : undefined,
    updatedAt: candidate.updatedAt,
    latestVersion:
      typeof candidate.latestVersion === "string"
        ? candidate.latestVersion
        : undefined,
    releaseNotes:
      typeof candidate.releaseNotes === "string"
        ? candidate.releaseNotes
        : undefined,
  };
}

export async function fetchStatusWorkerStatusDirect(): Promise<StatusWorkerStatus | null> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    STATUS_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(statusEndpointUrl(), {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return parseStatusWorkerStatus(await response.json());
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function canMessageBackground(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

export async function fetchStatusWorkerStatus(): Promise<StatusWorkerStatus | null> {
  if (!canMessageBackground()) {
    return fetchStatusWorkerStatusDirect();
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: STATUS_FETCH_MESSAGE_TYPE },
      (response: StatusWorkerFetchResponse | undefined) => {
        if (chrome.runtime.lastError || !response?.success) {
          resolve(null);
          return;
        }

        resolve(parseStatusWorkerStatus(response.status));
      },
    );
  });
}

export function isStatusWorkerFetchMessage(message: unknown): message is {
  type: typeof STATUS_FETCH_MESSAGE_TYPE;
} {
  return (
    Boolean(message) &&
    typeof message === "object" &&
    (message as { type?: unknown }).type === STATUS_FETCH_MESSAGE_TYPE
  );
}

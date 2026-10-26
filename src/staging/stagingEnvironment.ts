import { SUPABASE_URL } from "../config/supabase";
import type { V2GradeRequest } from "../types/api";
import { STATUS_WORKER_ORIGIN } from "../user-experience/status/statusWorker";

import {
  stagingGrades,
  stagingInstructorSearch,
  stagingUpcoming,
} from "./fixtures/instructors";
import { stagingPlanningStorage } from "./fixtures/planning";
import { stagingScheduleStorage } from "./fixtures/schedule";
import { stagingRegistrarResponse } from "./fixtures/sections";

/**
 * Stands in for the extension and its backends so staging renders the real
 * planner with dummy data. Only the data boundary is faked: `chrome.*`, the
 * registrar/Supabase/status requests and the MyPack cart endpoint.
 */

export type StagingEnvironmentOptions = {
  /** "test" keeps the synthetic TST audit the personal-planning smoke tests use. */
  planningDataset: "demo" | "test";
  /** Make the second approved-course list fail to load. */
  choicesUnavailable: boolean;
  /**
   * Send registrar, grade and instructor requests to their real URLs instead
   * of answering them in the page, so smoke tests can intercept them with
   * `page.route`.
   */
  realNetwork: boolean;
  /** Seed degree audit, planner and schedule data into `chrome.storage`. */
  seedStorage: boolean;
};

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

/** Registrar search through the network, like the background worker. */
async function fetchRegistrar(url: string, formData: string) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
    });
    const data = await res.text();
    return res.ok
      ? { success: true, data }
      : { success: false, error: `HTTP ${res.status} ${res.statusText}` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function installChromeStub(
  stored: Record<string, unknown>,
  realNetwork: boolean,
) {
  const listeners = new Set<StorageListener>();
  const notify = (changes: Record<string, chrome.storage.StorageChange>) => {
    for (const listener of listeners) listener(changes, "local");
  };
  const keysOf = (keys: unknown): string[] | null => {
    if (keys == null) return null;
    if (typeof keys === "string") return [keys];
    if (Array.isArray(keys)) return keys as string[];
    return Object.keys(keys as Record<string, unknown>);
  };
  const runtime = {
    lastError: undefined as chrome.runtime.LastError | undefined,
    sendMessage: (
      message: { type: string; url?: string; formData?: string },
      callback?: (result: unknown) => void,
    ) => {
      if (message.type === "fetchData" && realNetwork) {
        void fetchRegistrar(message.url ?? "", message.formData ?? "").then(
          (response) => callback?.(response),
        );
        return;
      }
      let response: unknown = {
        success: false,
        error: "Not available in staging",
      };
      if (message.type === "fetchData") {
        response = {
          success: true,
          data: stagingRegistrarResponse(message.formData ?? ""),
        };
      } else if (message.type === "status_worker_fetch") {
        response = {
          success: true,
          status: {
            ok: true,
            level: "ok",
            message: "All systems operational",
            updatedAt: new Date().toISOString(),
          },
        };
      }
      // Answer asynchronously, like the real background worker.
      window.setTimeout(() => callback?.(response), 30);
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (keys?: unknown) => {
            const wanted = keysOf(keys) ?? Object.keys(stored);
            const defaults =
              keys && typeof keys === "object" && !Array.isArray(keys)
                ? (keys as Record<string, unknown>)
                : {};
            return Object.fromEntries(
              wanted.map((key) => [key, stored[key] ?? defaults[key]]),
            );
          },
          set: async (items: Record<string, unknown>) => {
            const changes = Object.fromEntries(
              Object.entries(items).map(([key, value]) => [
                key,
                { oldValue: stored[key], newValue: value },
              ]),
            );
            Object.assign(stored, items);
            notify(changes);
          },
          remove: async (keys: string | string[]) => {
            const changes: Record<string, chrome.storage.StorageChange> = {};
            for (const key of keysOf(keys) ?? []) {
              if (!(key in stored)) continue;
              changes[key] = { oldValue: stored[key] };
              delete stored[key];
            }
            notify(changes);
          },
        },
        onChanged: {
          addListener: (listener: StorageListener) => listeners.add(listener),
          removeListener: (listener: StorageListener) =>
            listeners.delete(listener),
        },
      },
      runtime,
    },
  });
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const envelope = (data: unknown) =>
  json({ data, meta: { dataset_version: "staging" } });

function installFetchStub() {
  const realFetch = window.fetch.bind(window);
  const functionsBase = `${SUPABASE_URL}/functions/v1/`;
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(functionsBase)) {
      const slug = url.slice(functionsBase.length).split("?")[0];
      const body = JSON.parse(String(init?.body ?? "null"));
      switch (slug) {
        case "grades-v2-batch":
          return envelope(stagingGrades(body as V2GradeRequest[]));
        case "grades-v2-course":
          return envelope(stagingGrades([body as V2GradeRequest]));
        case "instructors-v2-search":
          return envelope(stagingInstructorSearch(body.q, body.limit));
        case "instructors-v2-upcoming":
          return envelope(stagingUpcoming(body));
      }
    }
    if (url.startsWith(STATUS_WORKER_ORIGIN)) {
      return json({
        ok: true,
        level: "ok",
        message: "All systems operational",
      });
    }
    // Add to cart builds a MyPack script URL from window.location.
    if (url.startsWith(`${window.location.origin}/s/`)) {
      return json({
        status: "success",
        title: "Added",
        message: "Added to cart",
      });
    }
    return realFetch(input, init);
  };
}

/** Drops cached sections and grades so fixture edits show on the next load. */
function clearCaches() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("mypack-course-sections-v1")) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* storage blocked */
  }
  // Open requests made after this wait for the delete to finish.
  indexedDB.deleteDatabase("mypack-extension-cache");
}

export function installStagingEnvironment(options: StagingEnvironmentOptions) {
  // Smoke tests rely on caches surviving a reload; they start from a fresh
  // browser profile anyway.
  if (!options.realNetwork) {
    clearCaches();
  }
  installChromeStub(
    options.seedStorage
      ? {
          ...stagingPlanningStorage({
            dataset: options.planningDataset,
            choicesUnavailable: options.choicesUnavailable,
          }),
          ...stagingScheduleStorage(),
        }
      : {},
    options.realNetwork,
  );
  if (!options.realNetwork) {
    installFetchStub();
  }
}

import { useState } from "react";

import MajorPlanSearch from "../course-management/components/search-tabs/MajorPlanSearch";
import {
  MajorPlanSearchDataInitialState,
  type MajorPlanSearchData,
  type TabUpdater,
} from "../course-management/components/tab-state/tabState";
import {
  auditKey,
  DEGREE_AUDITS_STORAGE_KEY,
} from "../degree-planning/services/degreeAudit";
import {
  personalAuditFixture,
  requirementFixture,
} from "../degree-planning/services/fixtures/personalPlanning";
import { PLANNING_SYNCED_AT_KEY } from "../degree-planning/services/planningSync";
import {
  parseRequirementChoices,
  REQUIREMENT_CHOICES_STORAGE_KEY,
} from "../degree-planning/services/requirementChoices";
import { type PlannerSectionPreview } from "../ui-system/components/workbench/workbenchTypes";

/** Staging-only bridge: no enrollment calls or real student records. */
export function installPersonalPlanningFixture() {
  const audit = { ...personalAuditFixture, capturedAt: Date.now() };
  const unavailable = new URLSearchParams(window.location.search).has(
    "unavailable",
  );
  const stored: Record<string, unknown> = {
    [DEGREE_AUDITS_STORAGE_KEY]: { [auditKey(audit)]: audit },
    [PLANNING_SYNCED_AT_KEY]: Date.now(),
    [REQUIREMENT_CHOICES_STORAGE_KEY]: {
      [auditKey(audit)]: {
        auditCapturedAt: audit.capturedAt,
        capturedAt: Date.now(),
        results: {
          "000001|": {
            list: parseRequirementChoices(requirementFixture(), "000001"),
            capturedAt: Date.now(),
          },
          "000002|": unavailable
            ? { error: "Choices unavailable: session expired" }
            : {
                list: parseRequirementChoices(
                  requirementFixture("000002"),
                  "000002",
                ),
                capturedAt: Date.now(),
              },
        },
      },
    },
  };
  const listeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => void
  >();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => {
            const changes = Object.fromEntries(
              Object.entries(items).map(([key, value]) => [
                key,
                { oldValue: stored[key], newValue: value },
              ]),
            );
            Object.assign(stored, items);
            for (const listener of listeners) listener(changes, "local");
          },
          remove: async (key: string) => {
            delete stored[key];
          },
        },
        onChanged: {
          addListener: (
            listener: typeof listeners extends Set<infer T> ? T : never,
          ) => listeners.add(listener),
          removeListener: (
            listener: typeof listeners extends Set<infer T> ? T : never,
          ) => listeners.delete(listener),
        },
      },
      runtime: {
        sendMessage: (
          message: { type: string },
          callback: (result: unknown) => void,
        ) => {
          if (message.type !== "fetchData")
            throw new Error(
              "Enrollment and other extension actions are disabled in staging.",
            );
          callback({
            success: true,
            data: JSON.stringify({
              html: `<div class="course"><h1>TST 440 <small>Database Systems</small><span class="units">Units: 3</span></h1><p>Synthetic section</p><table class="section-table"><tbody><tr><td>001</td><td>LEC</td><td>12345</td><td><span>Open</span> 10/30</td><td>MoWe 10:00 AM - 11:15 AM</td><td>Test Hall</td><td><a class="instructor-link">Test Instructor</a></td><td>01/01/2027 - 05/01/2027</td><td></td><td></td></tr></tbody></table></div>`,
            }),
          });
        },
      },
    },
  });
}

export function PersonalPlanningStaging() {
  const [data, setData] = useState<MajorPlanSearchData>({
    ...MajorPlanSearchDataInitialState,
  });
  const [preview, setPreview] = useState<PlannerSectionPreview | null>(null);
  const update: TabUpdater<MajorPlanSearchData> = (keyOrPatch, value) =>
    setData((previous) => ({
      ...previous,
      ...(typeof keyOrPatch === "string"
        ? { [keyOrPatch]: value }
        : keyOrPatch),
    }));
  return (
    <main className="mpp-root min-h-screen bg-background p-4 text-foreground">
      <h1 className="mb-4 text-xl font-semibold">
        Personal planning · synthetic MyPack fixture
      </h1>
      <MajorPlanSearch
        majorPlanSearchData={data}
        setMajorPlanSearchTabData={update}
        onPreviewSectionChange={setPreview}
        selectedPreviewId={preview?.id ?? null}
        previewContent={
          <p className="p-4">
            {preview
              ? "Section preview selected"
              : "Select a section to preview"}
          </p>
        }
      />
    </main>
  );
}

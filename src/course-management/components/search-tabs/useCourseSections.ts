import { useEffect, useRef, useState } from "react";

import { CATALOG_REVISION } from "../../../generated/catalogs/course-search/catalog";
import { GRADE_DATA_CACHE_VERSION } from "../../cache/courseRetrieval";
import { fetchPlannerCourseSections } from "../../services/api/planner-search/dataService";
import type { MergedCourseData } from "../../types/section";

/** Matches the open-courses cache, so seat counts refresh about as often. */
export const SECTIONS_SESSION_TTL_MS = 2 * 60 * 1000;

type Result = {
  key: string;
  data: MergedCourseData | null;
  loading: boolean;
  error: Error | null;
  progress: number;
  label: string;
};
const empty: Result = {
  key: "",
  data: null,
  loading: false,
  error: null,
  progress: 0,
  label: "",
};

/**
 * A fresh session entry's data, or undefined when it's missing, stale or
 * invalid. Entries written before the expiry existed have no `at`, so they
 * read as stale.
 */
export function readSessionEntry(
  key: string,
  now: number,
): MergedCourseData | null | undefined {
  const cached = sessionStorage.getItem(key);
  if (!cached) return undefined;
  const parsed = JSON.parse(cached);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.at !== "number" ||
    now - parsed.at >= SECTIONS_SESSION_TTL_MS
  ) {
    return undefined;
  }
  const { data } = parsed;
  if (
    data === null ||
    (typeof data === "object" &&
      data.sections &&
      typeof data.sections === "object")
  ) {
    return data;
  }
  return undefined;
}

export function useCourseSections(
  subject: string | null,
  catalogNum: string | null,
  id: string | undefined,
  term: string | null,
  load = fetchPlannerCourseSections,
) {
  const key =
    subject && catalogNum && /^\d+[A-Za-z]?$/.test(catalogNum) && term
      ? `mypack-course-sections-v2:${CATALOG_REVISION}:${GRADE_DATA_CACHE_VERSION}:${term}\u001f${subject}\u001f${catalogNum}`
      : "";
  const [result, setResult] = useState<Result>(empty);
  const [attempt, setAttempt] = useState(0);
  const current = useRef<{
    key: string;
    progress: (value: number, label?: string) => void;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!key || !subject || !catalogNum || !term) {
      setResult(empty);
      return;
    }
    setResult({ ...empty, key, loading: true, label: "Loading sections…" });
    try {
      const cached = readSessionEntry(key, Date.now());
      if (cached !== undefined) {
        setResult({ ...empty, key, data: cached });
        return;
      }
    } catch {
      /* An unavailable or invalid cache must not block searching. */
    }

    current.current = {
      key,
      progress: (progress, label) => {
        if (active)
          setResult((previous) => ({
            ...previous,
            progress,
            label: label ?? previous.label,
          }));
      },
    };
    // `load` shares requests already in flight for the same course and term.
    void load(
      subject,
      catalogNum,
      id,
      term,
      (progress, label) => {
        if (current.current?.key === key)
          current.current.progress(progress, label);
      },
      // Sections first; grade blocks show placeholders until the result replaces them.
      (partial) => {
        if (active) setResult((previous) => ({ ...previous, data: partial }));
      },
    )
      .then((data) => {
        try {
          sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
        } catch {
          /* quota */
        }
        return data;
      })
      .then(
        (data) => {
          if (active) setResult({ ...empty, key, data });
        },
        (error) => {
          if (active)
            setResult({
              ...empty,
              key,
              error:
                error instanceof Error
                  ? error
                  : new Error("Could not load sections"),
            });
        },
      );
    return () => {
      active = false;
      current.current = null;
    };
  }, [key, subject, catalogNum, id, term, attempt, load]);

  return {
    ...(result.key === key ? result : { ...empty, key, loading: Boolean(key) }),
    retry: () => setAttempt((value) => value + 1),
  };
}

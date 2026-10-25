import { useEffect, useRef, useState } from "react";

import { GRADE_DATA_CACHE_VERSION } from "../../cache/courseRetrieval";
import { fetchPlannerCourseSections } from "../../services/api/planner-search/dataService";
import type { MergedCourseData } from "../../types/section";

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

export function useCourseSections(
  subject: string | null,
  catalogNum: string | null,
  id: string | undefined,
  term: string | null,
  load = fetchPlannerCourseSections,
) {
  const key =
    subject && catalogNum && id && term
      ? `mypack-course-sections-v1:${GRADE_DATA_CACHE_VERSION}:${term}\u001f${subject}\u001f${id}`
      : "";
  const [result, setResult] = useState<Result>(empty);
  const [attempt, setAttempt] = useState(0);
  const requests = useRef(new Map<string, Promise<MergedCourseData | null>>());
  const current = useRef<{
    key: string;
    progress: (value: number, label?: string) => void;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!key || !subject || !catalogNum || !id || !term) {
      setResult(empty);
      return;
    }
    setResult({ ...empty, key, loading: true, label: "Loading sections…" });
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (
          parsed === null ||
          (typeof parsed === "object" &&
            parsed.sections &&
            typeof parsed.sections === "object")
        ) {
          setResult({ ...empty, key, data: parsed });
          return;
        }
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
    let request = requests.current.get(key);
    if (!request) {
      request = load(subject, catalogNum, id, term, (progress, label) => {
        if (current.current?.key === key)
          current.current.progress(progress, label);
      })
        .then((data) => {
          try {
            sessionStorage.setItem(key, JSON.stringify(data));
          } catch {
            /* quota */
          }
          return data;
        })
        .finally(() => requests.current.delete(key));
      requests.current.set(key, request);
    }
    void request.then(
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

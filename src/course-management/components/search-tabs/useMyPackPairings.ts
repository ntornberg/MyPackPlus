import { useCallback, useEffect, useMemo, useState } from "react";

import { AppLogger } from "../../../utils/logger";
import {
  applyOfferings,
  fetchMyPackOfferings,
  type MyPackOffering,
} from "../../services/myPackOfferings";
import type { GroupedSections } from "../../types/section";

/** The one course and term these groups belong to, or null when mixed or unknown. */
function courseAndTerm(
  sections: GroupedSections[],
): { code: string; term: string } | null {
  let found: { code: string; term: string } | null = null;
  for (const group of sections) {
    const code = group.lecture?.courseData?.code;
    const term = group.lecture?.term;
    if (!code || !term) {
      continue;
    }
    if (found && (found.code !== code || found.term !== term)) {
      return null;
    }
    found = { code, term };
  }
  return found;
}

/**
 * Regroups a course's sections by MyPack's own lecture/lab pairings once they
 * load. Until then, and off MyPack or when the request fails, the registrar
 * fallback grouping is returned unchanged.
 */
export function useMyPackPairings(
  sections: GroupedSections[],
): GroupedSections[] {
  return useMyPackPairingsState(sections).sections;
}

export function useMyPackPairingsState(sections: GroupedSections[]) {
  const target = useMemo(() => courseAndTerm(sections), [sections]);
  const code = target?.code;
  const term = target?.term;
  const [attempt, setAttempt] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [loaded, setLoaded] = useState<{
    key: string;
    offerings: MyPackOffering[];
  } | null>(null);

  useEffect(() => {
    if (!code || !term) {
      return;
    }
    let cancelled = false;
    const key = `${code}|${term}`;
    setLoadingKey(key);
    fetchMyPackOfferings(code, term, undefined, attempt > 0)
      .then((offerings) => {
        if (!cancelled && offerings) {
          setLoaded({ key: `${code}|${term}`, offerings });
        }
      })
      .catch((error: unknown) => {
        AppLogger.warn("MyPack pairings unavailable for", code, error);
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, term, attempt]);

  const paired = useMemo(
    () =>
      loaded && loaded.key === `${code}|${term}`
        ? applyOfferings(sections, loaded.offerings)
        : sections,
    [sections, loaded, code, term],
  );
  return { sections: paired, loading: loadingKey === `${code}|${term}`, retry };
}

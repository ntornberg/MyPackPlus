import { useState } from "react";

import CourseSearch from "../course-management/components/search-tabs/CourseSearch";
import {
  CourseSearchDataInitialState,
  type CourseSearchData,
  type TabUpdater,
} from "../course-management/components/tab-state/tabState";
import type { fetchPlannerCourseSections } from "../course-management/services/api/planner-search/dataService";
import type { MergedCourseData } from "../course-management/types/section";
import { getCourseSearchIndex } from "../course-management/utils/courseSearchIndex";

const loadSections: typeof fetchPlannerCourseSections = async (
  subject,
  number,
  id,
  term,
  onProgress,
) => {
  onProgress?.(20, "Loading staging sections…");
  const url = new URL("./courseSearchFixture.json", import.meta.url);
  url.search = new URLSearchParams({ subject, number, id, term }).toString();
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Sections unavailable (${response.status})`);
  const data: MergedCourseData | null = await response.json();
  onProgress?.(100, "Loaded staging sections");
  return data;
};

export function CourseSearchStaging() {
  const [data, setData] = useState<CourseSearchData>(() => {
    const code = new URLSearchParams(window.location.search).get("selected");
    const course = getCourseSearchIndex().find((item) => item.code === code);
    return course
      ? {
          ...CourseSearchDataInitialState,
          searchSubject: course.subject,
          searchCourse: course.label,
          selectedCourseInfo: {
            code: course.code,
            title: course.title,
            catalogNum: course.catalogNum,
            id: course.id,
          },
        }
      : CourseSearchDataInitialState;
  });
  const update: TabUpdater<CourseSearchData> = (patch, value) =>
    setData((previous) => ({
      ...previous,
      ...(typeof patch === "string" ? { [patch]: value } : patch),
    }));
  return (
    <div id="extension-overlay-root">
      <main className="mpp-root min-h-screen bg-background p-4 text-foreground">
        <h1 className="mb-4 text-xl font-semibold">
          Course search staging — synthetic sections
        </h1>
        <CourseSearch
          courseSearchData={data}
          setCourseSearchTabData={update}
          onPreviewSectionChange={() => {}}
          selectedPreviewId={null}
          previewContent={null}
          loadSections={loadSections}
        />
      </main>
    </div>
  );
}

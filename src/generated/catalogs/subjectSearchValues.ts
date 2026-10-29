import { CATALOG_SUBJECTS, subjectLabel } from "./course-search/catalog";

export const SubjectMenuValues: Record<string, string> = Object.fromEntries(
  Object.keys(CATALOG_SUBJECTS).map((code) => [code, subjectLabel(code)]),
);

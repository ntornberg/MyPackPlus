import snapshot from "./catalog.json";

export interface CatalogCourse {
  code: string;
  subject: string;
  catalogNum: string;
  title: string;
  description: string;
  currentCatalog: boolean;
  source?: string;
  registrarId?: string;
  idProvenance?: string;
  idSource?: string;
  idVerifiedAt?: string;
}

export const CATALOG_COURSES: readonly CatalogCourse[] = snapshot.courses;
export const CATALOG_SUBJECTS: Readonly<Record<string, string>> =
  snapshot.subjects;
export const CATALOG_REVISION = snapshot.revision;
export const EXACT_CART_COURSE_CODES = new Set(
  CATALOG_COURSES.filter((c) => c.idProvenance === "registrar-directory").map(
    (c) => c.code,
  ),
);
export const subjectLabel = (code: string) =>
  `${code} - ${CATALOG_SUBJECTS[code] ?? code}`;

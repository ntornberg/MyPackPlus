/**
 * MyPack lists class components by short codes ("Lab", "Rec", "Pro", ...).
 * These turn them into names a student recognises.
 */
const COMPONENT_NAMES: Record<string, { name: string; plural: string }> = {
  lec: { name: "Lecture", plural: "Lecture sections" },
  lab: { name: "Lab", plural: "Lab sections" },
  rec: { name: "Recitation", plural: "Recitation sections" },
  pro: { name: "Problem session", plural: "Problem sessions" },
  stu: { name: "Studio", plural: "Studio sections" },
  sem: { name: "Seminar", plural: "Seminar sections" },
  dis: { name: "Discussion", plural: "Discussion sections" },
  clq: { name: "Colloquium", plural: "Colloquium sections" },
  prc: { name: "Practicum", plural: "Practicum sections" },
  fld: { name: "Field work", plural: "Field work sections" },
  ind: { name: "Independent study", plural: "Independent study sections" },
  int: { name: "Internship", plural: "Internship sections" },
  res: { name: "Research", plural: "Research sections" },
};

/** "Pro" → "Problem session"; unknown codes are returned as given. */
export function componentDisplayName(code: string | undefined): string {
  const raw = (code ?? "").trim();
  return COMPONENT_NAMES[raw.toLowerCase()]?.name ?? raw;
}

/** Heading for a list of one component: "Pro" → "Problem sessions". */
export function componentPluralTitle(code: string | undefined): string {
  const raw = (code ?? "").trim();
  const known = COMPONENT_NAMES[raw.toLowerCase()];
  if (known) {
    return known.plural;
  }
  return raw ? `${raw} sections` : "Linked sections";
}

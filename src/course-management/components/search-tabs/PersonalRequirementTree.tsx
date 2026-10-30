import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

import {
  requisiteTermLabel,
  type DegreeAudit,
  type DegreeAuditLine,
} from "../../../degree-planning/services/degreeAudit";
import {
  plannedTermFor,
  type PlannerIndex,
} from "../../../degree-planning/services/packPlanner";
import {
  auditLineCourse,
  matchesAuditCourse,
  personalRequirementSections,
  type PersonalRequirement,
} from "../../../degree-planning/services/personalRequirements";
import type {
  RequirementChoices,
  ApprovedCourse,
} from "../../../degree-planning/services/requirementChoices";
import type { RequiredCourse } from "../../../degree-planning/types/Plans";
import type { MergedCourseData } from "../../types/section";

const STATUS_LABEL = {
  C: "Completed",
  E: "Enrolled",
  P: "Planned",
  I: "Incomplete / late",
  U: "Unmet",
  "": "Audit entry",
};

function Attempt({
  line,
  appliedHere,
}: {
  line: DegreeAuditLine;
  appliedHere: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {line.subject} {line.catalogNbr} {line.title}
        </span>
        <Badge variant="outline">{STATUS_LABEL[line.status]}</Badge>
        <span className="text-xs text-muted-foreground">
          {line.term}
          {line.grade ? ` · ${line.grade}` : ""}
          {line.units ? ` · ${line.units} units` : ""}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {appliedHere
          ? "Listed by MyPack under this requirement"
          : "Recorded elsewhere in this audit; not counted here"}
      </span>
      {line.note ? (
        <p className="text-sm text-muted-foreground">{line.note}</p>
      ) : null}
    </div>
  );
}

function Choice({
  course,
  requirement,
  attempts,
  planner,
  openCourses,
  sectionsSearched,
  renderSections,
}: {
  course: ApprovedCourse;
  requirement: PersonalRequirement;
  attempts: DegreeAuditLine[];
  planner: PlannerIndex | null;
  openCourses: Record<string, MergedCourseData>;
  sectionsSearched: boolean;
  renderSections: (course: RequiredCourse) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const here = requirement.applied.filter((line) =>
    matchesAuditCourse(course, line),
  );
  const elsewhere = attempts.filter(
    (line) =>
      !requirement.applied.includes(line) && matchesAuditCourse(course, line),
  );
  const recorded = [...here, ...elsewhere];
  const planned =
    !recorded.length && planner
      ? plannedTermFor(
          planner,
          course.course_id,
          course.course_abr,
          course.catalog_num,
        )
      : null;
  const count = Object.keys(
    openCourses[`${course.course_abr} ${course.catalog_num}`]?.sections ?? {},
  ).length;
  return (
    <details
      className="border-t border-border p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">
          {course.course_abr} {course.catalog_num}
        </span>{" "}
        · {course.course_descrip}
        <span className="ml-2 text-xs text-muted-foreground">
          {here.length
            ? "Applied here"
            : elsewhere.length
              ? "Recorded elsewhere"
              : planned
                ? "In Pack Planner"
                : "Approved choice"}
          {sectionsSearched
            ? ` · ${count ? `${count} section groups` : "No sections found this term"}`
            : ""}
        </span>
      </summary>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {course.minUnits}–{course.maxUnits} units · Take units:{" "}
            {course.takeUnits}
            {course.pendingType ? ` · ${course.pendingType}` : ""}
          </p>
          {recorded.map((line, index) => (
            <Attempt
              key={index}
              line={line}
              appliedHere={here.includes(line)}
            />
          ))}
          {planned ? (
            <p className="text-sm text-muted-foreground">
              In Pack Planner · {planned}. MyPack has not confirmed allocation
              to this requirement.
            </p>
          ) : null}
          {sectionsSearched ? (
            renderSections(course)
          ) : (
            <p className="text-sm text-muted-foreground">
              Search to find sections for the selected semester.
            </p>
          )}
        </div>
      ) : null}
    </details>
  );
}

function ApprovedChoices({
  requirement,
  attempts,
  planner,
  openCourses,
  sectionsSearched,
  renderSections,
}: {
  requirement: PersonalRequirement;
  attempts: DegreeAuditLine[];
  planner: PlannerIndex | null;
  openCourses: Record<string, MergedCourseData>;
  sectionsSearched: boolean;
  renderSections: (course: RequiredCourse) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const result = requirement.choices;
  return (
    <div className="mt-3">
      {result?.error ? (
        <p role="status" className="mb-2 text-sm text-destructive">
          {result.error}
          {result.list
            ? " Showing previously loaded choices; refresh to retry."
            : ""}
        </p>
      ) : null}
      {result?.list ? (
        <>
          {result.list.note ? (
            <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {result.list.note}
            </p>
          ) : null}
          {result.list.message ? (
            <p className="mb-2 text-sm">{result.list.message}</p>
          ) : null}
          <p className="mb-2 text-xs text-muted-foreground">
            {result.list.minUnits > 0
              ? `MyPack minimum: ${result.list.minUnits} units. `
              : ""}
            {result.list.minCourses > 0
              ? `Minimum courses: ${result.list.minCourses}. `
              : ""}
            Eligibility does not assign credit to this requirement.
          </p>
          <details
            className="rounded-md border border-border"
            onToggle={(event) => setOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer p-3 text-sm font-medium">
              Approved choices ·{" "}
              {result.list.groups.reduce(
                (n, group) => n + group.courses.length,
                0,
              )}{" "}
              course entries
            </summary>
            {open
              ? result.list.groups.map((group, index) => (
                  <div
                    key={`${group.id}:${index}`}
                    className="border-t border-border"
                  >
                    <h5 className="bg-muted/40 px-3 py-2 text-sm font-medium">
                      {group.name}
                    </h5>
                    {group.minUnits > 0 ||
                    group.maxUnits > 0 ||
                    group.minGradePoints > 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        {group.minUnits > 0
                          ? `Minimum units: ${group.minUnits}. `
                          : ""}
                        {group.maxUnits > 0
                          ? `Maximum units allowed: ${group.maxUnits}. `
                          : ""}
                        {group.minGradePoints > 0
                          ? `Minimum grade points: ${group.minGradePoints}.`
                          : ""}
                      </p>
                    ) : null}
                    {group.courses.map((course, courseIndex) => (
                      <Choice
                        key={`${course.course_id}:${course.offeringNumber}:${courseIndex}`}
                        {...{
                          course,
                          requirement,
                          attempts,
                          planner,
                          openCourses,
                          sectionsSearched,
                          renderSections,
                        }}
                      />
                    ))}
                  </div>
                ))
              : null}
            {open && result.list.groups.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                MyPack returned no course groups. Check its advising notes or
                consult your advisor.
              </p>
            ) : null}
          </details>
        </>
      ) : !result?.error ? (
        <p className="text-sm text-muted-foreground">
          Approved choices have not been loaded. Search to load them from
          MyPack.
        </p>
      ) : null}
    </div>
  );
}

export function PersonalRequirementTree({
  audit,
  choices,
  planner,
  openCourses,
  sectionsSearched,
  renderSections,
}: {
  audit: DegreeAudit;
  choices?: RequirementChoices;
  planner: PlannerIndex | null;
  openCourses: Record<string, MergedCourseData>;
  sectionsSearched: boolean;
  renderSections: (course: RequiredCourse) => ReactNode;
}) {
  const sections = useMemo(
    () => personalRequirementSections(audit, choices),
    [audit, choices],
  );
  const attempts = useMemo(
    () => audit.groups.flatMap((group) => group.lines),
    [audit],
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {audit.name || audit.plan} · {audit.subplan} · Requisite term:{" "}
        {requisiteTermLabel(audit.reqTerm)}
        <br />
        Audit loaded {new Date(audit.capturedAt).toLocaleString()}
        {choices?.auditCapturedAt === audit.capturedAt
          ? ` · Choices loaded ${new Date(choices.capturedAt).toLocaleString()}`
          : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        MyPack determines where credit counts. Courses shown as eligible or in
        Pack Planner do not change the audit’s allocation. All approved choices
        remain visible even when no sections are found.
      </p>
      {sections.map(({ group, requirements }, index) => (
        <details
          key={`${group.id}:${index}`}
          className="rounded-lg border border-border bg-card/50"
        >
          <summary className="cursor-pointer px-4 py-3 font-semibold">
            {group.name}{" "}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {STATUS_LABEL[group.status]}
              {group.minUnits > 0 ? ` · Minimum ${group.minUnits} units` : ""}
            </span>
          </summary>
          {requirements.map((requirement) => (
            <section
              key={requirement.key}
              className="border-t border-border p-4"
            >
              <h4 className="mb-3 font-medium">
                {requirement.choices?.list?.name || requirement.name}
              </h4>
              <div className="flex flex-col gap-3">
                {requirement.applied.map((line, rowIndex) => (
                  <div key={rowIndex}>
                    <Attempt line={line} appliedHere />
                    {!requirement.hasChoiceList &&
                    line.subject &&
                    line.catalogNbr &&
                    sectionsSearched ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-primary">
                          View sections for {line.subject} {line.catalogNbr}
                        </summary>
                        {renderSections(auditLineCourse(line))}
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
              {requirement.hasChoiceList ? (
                <ApprovedChoices
                  {...{
                    requirement,
                    attempts,
                    planner,
                    openCourses,
                    sectionsSearched,
                    renderSections,
                  }}
                />
              ) : null}
            </section>
          ))}
        </details>
      ))}
    </div>
  );
}

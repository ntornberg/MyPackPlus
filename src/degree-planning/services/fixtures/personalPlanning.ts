import { parseDegreeDetailsResponse, type DegreeAudit } from "../degreeAudit";

// Synthetic records matching the MyPack shapes inspected during the investigation.
export const auditFixtureLine = (overrides: Record<string, string> = {}) => ({
  subject: "TST",
  catalog_nbr: "297",
  crse_id: "000297",
  crse_offer_nbr: "1",
  descr: "Special Topics",
  term: "2258",
  term_descr: "Fall '25",
  grade: "S",
  units: "1.000",
  requirement: "000001",
  req_descr: "Electives Group A",
  status: "C",
  MultipleUse: "N",
  is_exc_req: "",
  note: "Topic: Alpha, Approved Exception",
  ...overrides,
});

export const personalAuditHtml = `<script>var details = ${JSON.stringify({
  rqrmnt_groups: [
    {
      rq_grp_nbr: "000100",
      rq_grp_descr: "Core",
      min_units_reqd: "0",
      rq_grp_lines: [
        auditFixtureLine({
          catalog_nbr: "101",
          crse_id: "000101",
          descr: "Core Course",
          requirement: "",
          req_descr: "",
          note: "",
          grade: "A",
          units: "3.000",
        }),
      ],
    },
    {
      rq_grp_nbr: "000200",
      rq_grp_descr: "Other Electives",
      min_units_reqd: "0",
      rq_grp_lines: [
        auditFixtureLine(),
        auditFixtureLine({
          term: "2261",
          term_descr: "Spring '26",
          note: "Topic: Beta, Approved Exception",
        }),
        auditFixtureLine({
          catalog_nbr: "406",
          crse_id: "000406",
          crse_offer_nbr: "0",
          descr: "Parallel Computing",
          term: "2271",
          term_descr: "Spring '27",
          status: "P",
          grade: "",
          units: "3.000",
          note: "Course provides excess units",
        }),
        auditFixtureLine({
          catalog_nbr: "301",
          crse_id: "000301",
          descr: "Applied Elsewhere",
          requirement: "000002",
          req_descr: "Electives Group B",
          grade: "A",
          units: "3.000",
          note: "",
        }),
        auditFixtureLine({
          catalog_nbr: "471",
          crse_id: "000471",
          descr: "Security Topics",
          requirement: "000002",
          req_descr: "Electives Group B",
          status: "E",
          term: "2268",
          term_descr: "Fall '26",
          grade: "",
          units: "3.000",
          note: "",
        }),
        // Units still owed. As in real audits, an unmet ("U") row for a
        // course list has the requirement id and name but no course, and its
        // units may read "Verify".
        ...[
          ["000001", "Electives Group A"],
          ["000002", "Electives Group B"],
        ].map(([requirement, name]) =>
          auditFixtureLine({
            subject: "",
            catalog_nbr: "",
            crse_id: "",
            crse_offer_nbr: "",
            descr: name,
            req_descr: name,
            term: "",
            term_descr: "",
            grade: "",
            units: "Verify",
            note: "",
            status: "U",
            requirement,
          }),
        ),
      ],
    },
  ],
})};</script>`;

export const personalAuditUrl =
  "https://portalsp.acs.ncsu.edu/psc/CS92PRD/EMPLOYEE/NCSIS/s/WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.IScript_getDegreeDetails?acad_plan=TESTBS&acad_sub_plan=NOSUBPLAN&acad_plan_type=MAJ&req_term=2238";
export const personalAuditFixture: DegreeAudit = {
  ...parseDegreeDetailsResponse(personalAuditHtml, personalAuditUrl, 1000)!,
  name: "Testing BS",
};

export const approvedFixtureCourse = (
  catalog_nbr = "440",
  overrides: Record<string, string> = {},
) => ({
  crse_id: `000${catalog_nbr}`,
  crse_offer_nbr: "1",
  subject: "TST",
  catalog_nbr,
  crse_title: `Approved Course ${catalog_nbr}`,
  units_min: "3.00",
  units_max: "3.00",
  take_units: "3.00",
  pending_type: "",
  ...overrides,
});
export const requirementFixture = (requirement = "000001") => ({
  requirement,
  rq_main_descr:
    requirement === "000001" ? "Electives Group A" : "Electives Group B",
  rq_main_min_units_reqd: "6.00",
  rq_main_min_crses_reqd: "0.00",
  rq_main_code: "Consult your advisor for topic and enrollment restrictions.",
  message: "",
  rq_lines: [
    {
      rq_line_key_nbr: "0001",
      rq_line_descr: "Choose an approved course",
      rq_line_min_units_reqd: "0.00",
      rq_line_max_units_allowd: "0.00",
      rq_line_grade_points_min: "0.00",
      courses:
        requirement === "000001"
          ? [
              approvedFixtureCourse("301"),
              approvedFixtureCourse("297", {
                units_min: "1.00",
                units_max: "1.00",
                take_units: "1.00",
              }),
              approvedFixtureCourse("499"),
            ]
          : [approvedFixtureCourse("301"), approvedFixtureCourse("471")],
    },
    {
      rq_line_key_nbr: "0002",
      rq_line_descr: "TST 440 or TST 540",
      rq_line_min_units_reqd: "0.00",
      rq_line_max_units_allowd: "3.00",
      rq_line_grade_points_min: "0.00",
      courses: [
        approvedFixtureCourse("440"),
        approvedFixtureCourse("540", {
          crse_id: "000440",
          crse_offer_nbr: "2",
        }),
        approvedFixtureCourse("540", {
          crse_id: "000440",
          crse_offer_nbr: "3",
          subject: "OTH",
        }),
      ],
    },
  ],
});

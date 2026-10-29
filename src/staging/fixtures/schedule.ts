import { DEFAULT_TERM_NAME } from "../../course-management/components/tab-state/tabState";
import { TERM_TAG_FIELD } from "../../course-management/utils/semester";

import { instructorForSection } from "./instructors";
import { stagingClassNumber } from "./sections";

/**
 * Enrolled and shopping-cart classes the preview calendar draws behind a
 * section. Each is section 001 with the class number the dummy registrar gives
 * it, so the Schedule tab can match and remove it.
 */

type Meeting = {
  code: string;
  title: string;
  days: string;
  time: string;
  location: string;
  /** A lab taken with section 001, so the Schedule tab's lab picker has something to show. */
  lab?: { section: string; days: string; time: string; location: string };
};

const ENROLLED: Meeting[] = [
  {
    code: "CSC 326",
    title: "Software Engineering",
    days: "Tue/Thu",
    time: "10:15 AM - 11:30 AM",
    location: "Engineering Bldg II 1231",
  },
  {
    code: "CSC 411",
    title: "Introduction to Artificial Intelligence",
    days: "Mon/Wed",
    time: "1:30 PM - 2:45 PM",
    location: "Engineering Bldg III 2211",
  },
];

const CART: Meeting[] = [
  {
    code: "CH 101",
    title: "Chemistry - A Molecular Science",
    days: "Tue/Thu",
    time: "3:00 PM - 4:15 PM",
    location: "Dabney Hall 222",
    lab: {
      section: "201A",
      days: "Tue",
      time: "9:00 AM - 10:50 AM",
      location: "Poe Hall 216",
    },
  },
  {
    code: "ST 370",
    title: "Probability and Statistics for Engineers",
    days: "Mon/Wed/Fri",
    time: "9:35 AM - 10:25 AM",
    location: "SAS Hall 1102",
  },
  {
    code: "ENG 331",
    title: "Communication for Engineering and Technology",
    days: "Tue/Thu",
    time: "1:30 PM - 2:45 PM",
    location: "Tompkins Hall G108",
  },
];

function tableEntry(meeting: Meeting) {
  const [subject = ""] = meeting.code.split(" ");
  return {
    classs: meeting.code,
    crse_title: meeting.title,
    description: meeting.title,
    enroll_class_nbr: stagingClassNumber(meeting.code, "001"),
    // MyPack's format; CH 101 with its lab is the 4-hour one.
    units: meeting.lab ? "4.00" : "3.00",
    [TERM_TAG_FIELD]: DEFAULT_TERM_NAME,
    section_details: [
      {
        section: "001",
        class_nbr: stagingClassNumber(meeting.code, "001"),
        type: "Lecture",
        location: meeting.location,
        facility: meeting.location,
        instructors: [
          instructorForSection(subject, `${meeting.code}:001`).instructor_name,
        ],
        meet_days: meeting.days,
        time: meeting.time,
        dates: "01/07/2027 - 04/23/2027",
      },
      ...(meeting.lab
        ? [
            {
              section: meeting.lab.section,
              class_nbr: stagingClassNumber(meeting.code, meeting.lab.section),
              type: "Laboratory",
              location: meeting.lab.location,
              facility: meeting.lab.location,
              instructors: [
                instructorForSection(
                  subject,
                  `${meeting.code}:${meeting.lab.section}`,
                ).instructor_name,
              ],
              meet_days: meeting.lab.days,
              time: meeting.lab.time,
              dates: "01/07/2027 - 04/23/2027",
            },
          ]
        : []),
    ],
  };
}

function cacheCategory(meetings: Meeting[]) {
  const timestamp = Date.now();
  return Object.fromEntries(
    meetings.map((meeting) => [
      `staging-${stagingClassNumber(meeting.code, "001")}`,
      {
        // Objects, as the extension stores captured MyPack rows.
        combinedData: tableEntry(meeting),
        timestamp,
        expiresAt: timestamp + 24 * 60 * 60 * 1000,
      },
    ]),
  );
}

export function stagingScheduleStorage(): Record<string, unknown> {
  return {
    scheduleTableData: cacheCategory(ENROLLED),
    shopCartTableData: cacheCategory(CART),
  };
}

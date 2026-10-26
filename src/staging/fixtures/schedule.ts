import { DEFAULT_TERM_NAME } from "../../course-management/components/tab-state/tabState";
import { TERM_TAG_FIELD } from "../../course-management/utils/semester";

import { instructorForSection } from "./instructors";

/** Enrolled and shopping-cart classes the preview calendar draws behind a section. */

type Meeting = {
  code: string;
  title: string;
  classNumber: string;
  days: string;
  time: string;
  location: string;
};

const ENROLLED: Meeting[] = [
  {
    code: "CSC 326",
    title: "Software Engineering",
    classNumber: "13245",
    days: "Tue/Thu",
    time: "10:15 AM - 11:30 AM",
    location: "Engineering Bldg II 1231",
  },
  {
    code: "CSC 411",
    title: "Introduction to Artificial Intelligence",
    classNumber: "13377",
    days: "Mon/Wed",
    time: "1:30 PM - 2:45 PM",
    location: "Engineering Bldg III 2211",
  },
];

const CART: Meeting[] = [
  {
    code: "ST 370",
    title: "Probability and Statistics for Engineers",
    classNumber: "15102",
    days: "Mon/Wed/Fri",
    time: "9:35 AM - 10:25 AM",
    location: "SAS Hall 1102",
  },
  {
    code: "ENG 331",
    title: "Communication for Engineering and Technology",
    classNumber: "11820",
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
    enroll_class_nbr: meeting.classNumber,
    [TERM_TAG_FIELD]: DEFAULT_TERM_NAME,
    section_details: [
      {
        section: "001",
        class_nbr: meeting.classNumber,
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
    ],
  };
}

function cacheCategory(meetings: Meeting[]) {
  const timestamp = Date.now();
  return Object.fromEntries(
    meetings.map((meeting) => [
      `staging-${meeting.classNumber}`,
      {
        combinedData: JSON.stringify(tableEntry(meeting)),
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

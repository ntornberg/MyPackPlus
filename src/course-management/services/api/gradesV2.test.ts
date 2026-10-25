import { describe, expect, it, vi } from "vitest";

import type { V2CoursesData, V2Instructor } from "../../../types/api";

import {
  instructorToProf,
  splitInstructorName,
  v2ToBatchResponse,
} from "./gradesV2";

vi.mock("../../cache/courseRetrieval", () => ({
  GRADE_DATA_CACHE_VERSION: "v2",
  generateCacheKey: vi.fn(),
  getGenericCache: vi.fn(),
  setGenericCache: vi.fn(),
  noteGradeDatasetVersion: vi.fn(),
}));

const instructor: V2Instructor = {
  instructor_id: "mcweast",
  unity_id: "mcweast",
  instructor_name: "Varron,Madi",
  names: ["Varron,Madi"],
  subjects: ["ARE"],
  has_gradient_grades: true,
  historical_courses: ["ARE 201"],
  historical_sections: 3,
  historical_students: 90,
  last_grade_year: 2025,
  rmp: {
    rating_state: "no_reviews",
    avg_rating: null,
    num_ratings: 0,
    primary_profile_id: 123,
    profiles: [],
  },
};

describe("v2ToBatchResponse", () => {
  it("keys rows by the caller's request, not the server's names", () => {
    const data: V2CoursesData = {
      results: [
        {
          request: {
            course: "ARE 201",
            instructor_name: "Varron, Madi",
            unity_id: null,
          },
          instructor_id: "mcweast",
          ambiguous: false,
          grade: {
            unique_hash: "1",
            subject: "ARE",
            course_name: "ARE 201",
            instructor_name: "Varron,Madi",
            a_average: 50,
            b_average: 50,
            c_average: 0,
            d_average: 0,
            f_average: 0,
            class_avg_max: null,
            class_avg_min: null,
            link_status: "linked",
            section_count: 3,
            total_students: 90,
            letter_graded_students: 0,
            grade_counts: null,
            terms: ["Fall '25"],
          },
        },
        {
          request: {
            course: "ARE 201",
            instructor_name: "Smith,Pat",
            unity_id: null,
          },
          instructor_id: null,
          ambiguous: true,
          grade: null,
        },
      ],
      instructors: { mcweast: instructor },
    };

    const batch = v2ToBatchResponse(data);

    expect(batch.courses).toHaveLength(1);
    expect(batch.courses![0]).toMatchObject({
      course_name: "ARE 201",
      instructor_name: "Varron, Madi",
      class_avg_max: 0,
      letter_graded_students: 0,
    });
    // Ambiguous names produce no professor rather than guessing a person.
    expect(batch.profs).toHaveLength(1);
    expect(batch.profs![0]).toMatchObject({
      master_name: "Varron, Madi",
      ratingState: "no_reviews",
      numRatings: 0,
      avgRating: null,
      id: "123",
    });
  });
});

describe("instructorToProf", () => {
  it("splits registrar names into first and last", () => {
    expect(splitInstructorName("Griggs,John Richard")).toEqual({
      first: "John Richard",
      last: "Griggs",
    });
    const prof = instructorToProf(instructor, "Varron,Madi");
    expect(prof.first_name).toBe("Madi");
    expect(prof.last_name).toBe("Varron");
    expect(prof.instructor).toBe(instructor);
  });
});

/** Discovery and public section searches do not require registration identity. */
export type CourseQuery = {
  readonly course_abr: string;
  readonly catalog_num: string;
  readonly course_descrip: string;
  readonly course_id?: string;
};

import { describe, expect, it } from 'vitest';

import {
  announcementPatchSchema,
  departmentPatchSchema,
  roomPatchSchema,
  staffPatchSchema,
} from './administration.schema';

/**
 * Each PATCH schema parses to what the client sent and nothing else
 * (`patchOf`). Under Zod 4, `.partial()` of the create schema filled in
 * every default, so a rename also reset a staff member's status and
 * permissions, a department's head and a room's status.
 */
describe('the Administration Center PATCH schemas', () => {
  it.each([
    ['staff', staffPatchSchema, { name: 'Renamed' }],
    ['department', departmentPatchSchema, { name: 'Renamed' }],
    ['room', roomPatchSchema, { name: 'Renamed' }],
    ['announcement', announcementPatchSchema, { title: 'Renamed' }],
  ] as const)('%s: a rename parses to the rename alone', (_label, schema, body) => {
    expect(schema.parse(body)).toEqual(body);
  });

  it('still lets a department head be cleared with an explicit null', () => {
    expect(departmentPatchSchema.parse({ headStaffId: null })).toEqual({ headStaffId: null });
  });
});

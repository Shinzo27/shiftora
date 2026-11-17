import { schema } from '@shiftora/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  createOrg,
  signUp,
  startTestApp,
  type TestApp,
  type TestUser,
} from '../../../testing/test-app.js';
import { EXPORT_PAGE } from '../payroll-export.service.js';

/**
 * W6 D5: the payroll export — a 500-employee month, streamed in pages, as CSV (a row per person,
 * or per day and kind) and as XLSX (both sheets). The "done when": it exports, completely and
 * correctly, well past one page.
 */

let t: TestApp;
let owner: TestUser;
let org: string;
let periodId: string;

const EMPLOYEES = 500;
const DAYS = 31;
// A regular line every day, plus an overtime line on 15 of them: 500 × 46 = 23 000 lines.
const LINES = EMPLOYEES * (DAYS + 15);

beforeAll(async () => {
  t = await startTestApp();
  owner = await signUp(t.app, 'Priya Nair');
  org = await createOrg(owner);

  await t.queryAs({ userId: owner.id, orgId: org }, async (tx) => {
    const [period] = await tx
      .insert(schema.payPeriods)
      .values({
        orgId: org,
        startsOn: '2026-12-01',
        endsOn: '2026-12-31',
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: owner.id,
        calculatedAt: new Date(),
      })
      .returning();
    periodId = period!.id;

    const staff = await tx
      .insert(schema.employees)
      .values(
        Array.from({ length: EMPLOYEES }, (_, i) => ({
          orgId: org,
          // One name with a comma and a quote, to prove the CSV quoting.
          name: i === 0 ? 'Mehta, Asha "Ash"' : `Employee ${String(i).padStart(3, '0')}`,
          email: `e${i}@clinic.test`,
          hourlyRateMinor: 30_000,
        })),
      )
      .returning({ id: schema.employees.id });

    const lines = staff.flatMap(({ id }) =>
      Array.from({ length: DAYS }, (_, d) => {
        const regular = {
          orgId: org,
          payPeriodId: periodId,
          employeeId: id,
          date: `2026-12-${String(d + 1).padStart(2, '0')}`,
          category: 'regular',
          night: false,
          minutes: 480,
          multiplierBp: 10_000,
          rateMinor: 30_000,
          amountMinor: 240_000,
          currency: 'INR',
        };
        const overtime = {
          ...regular,
          category: 'overtime',
          minutes: 60,
          multiplierBp: 15_000,
          amountMinor: 45_000,
        };
        return d % 2 === 1 ? [regular, overtime] : [regular];
      }).flat(),
    );
    for (let i = 0; i < lines.length; i += 2_000) {
      await tx.insert(schema.timesheetLines).values(lines.slice(i, i + 2_000));
    }
  });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

function download(user: TestUser, query: string, inOrg = org, id = periodId) {
  return t.app.inject({
    method: 'GET',
    url: `/api/v1/pay-periods/${id}/export?${query}`,
    headers: { authorization: `Bearer ${user.token}`, 'x-org-id': inOrg },
  });
}

/** Splits a CSV body into rows, honouring quoted fields (no field here spans lines). */
function csvRows(body: string): string[][] {
  return body
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i]!;
        if (quoted && char === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) {
          cells.push(current);
          current = '';
        } else current += char;
      }
      cells.push(current);
      return cells;
    });
}

describe('payroll export, 500 employees', () => {
  it('is many pages long, so paging is really exercised', () => {
    expect(LINES).toBeGreaterThan(EXPORT_PAGE * 20);
  });

  it('CSV summary: a row per person, totals right, quoting right, Excel-ready', async () => {
    const res = await download(owner, 'format=csv&view=summary');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="payroll-2026-12-01-to-2026-12-31-summary.csv"',
    );
    expect(res.body.startsWith('\uFEFFEmployee,Email,Regular hours')).toBe(true);
    const rows = csvRows(res.body);
    expect(rows).toHaveLength(EMPLOYEES + 1);
    expect(rows[1]).toEqual([
      'Employee 001',
      'e1@clinic.test',
      '248.00', // 31 × 8 h
      '15.00', // 15 × 1 h
      '0.00',
      '300.00',
      (31 * 2_400 + 15 * 450).toFixed(2),
      'INR',
    ]);
    // The name with a comma and quotes sorts last and survives the round trip.
    expect(rows.at(-1)![0]).toBe('Mehta, Asha "Ash"');
  });

  it('CSV lines: every line, in order, across all the pages', async () => {
    const res = await download(owner, 'format=csv&view=lines');
    const rows = csvRows(res.body);
    expect(rows).toHaveLength(LINES + 1);
    expect(rows[1]).toEqual([
      'Employee 001',
      '2026-12-01',
      'Regular',
      'No',
      '8.00',
      '1.00',
      '300.00',
      '2400.00',
      'INR',
    ]);
  });

  it('XLSX: both sheets, complete', async () => {
    const res = await download(owner, 'format=xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const workbook = new ExcelJS.Workbook();
    // exceljs's typings predate Node's generic Buffer; the bytes are the same.
    await workbook.xlsx.load(res.rawPayload as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet('Summary')!.rowCount).toBe(EMPLOYEES + 1);
    expect(workbook.getWorksheet('Lines')!.rowCount).toBe(LINES + 1);
    expect(workbook.getWorksheet('Summary')!.getRow(2).getCell(3).value).toBe('248.00');
  }, 60_000);

  it('only an owner exports; another org cannot see it', async () => {
    const manager = await addMember(t.app, owner, org, 'manager');
    expect((await download(manager, 'format=csv')).statusCode).toBe(403);

    const stranger = await signUp(t.app, 'Other Owner');
    const otherOrg = await createOrg(stranger);
    expect((await download(stranger, 'format=csv', otherOrg)).statusCode).toBe(404);
  });

  it('a period that is not approved yet cannot be exported (409)', async () => {
    const draft = await owner.call('POST', '/pay-periods', {
      org,
      body: { startsOn: '2027-01-01', endsOn: '2027-01-31' },
    });
    const res = await download(owner, 'format=csv', org, draft.json<{ id: string }>().id);
    expect(res.statusCode).toBe(409);
  });
});

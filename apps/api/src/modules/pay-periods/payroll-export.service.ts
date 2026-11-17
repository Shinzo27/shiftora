import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { errorCodes, type PayrollExportQuery } from '@shiftora/shared';
import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

import { AppException } from '../../common/app-exception.js';
import { PayPeriodsRepository, type PayPeriodRecord } from './pay-periods.repository.js';

/** Rows fetched per query: the export never holds more than this many in memory. */
export const EXPORT_PAGE = 1_000;

const SUMMARY_HEADER = [
  'Employee',
  'Email',
  'Regular hours',
  'Overtime hours',
  'Night hours',
  'Base rate',
  'Amount',
  'Currency',
];
const LINES_HEADER = [
  'Employee',
  'Date',
  'Kind',
  'Night',
  'Hours',
  'Rate ×',
  'Base rate',
  'Amount',
  'Currency',
];

/** 125 minutes → "2.08"; 15 050 paise → "150.50". Text, so a spreadsheet shows what we computed. */
const hours = (minutes: number) => (minutes / 60).toFixed(2);
const money = (minor: number) => (minor / 100).toFixed(2);
const times = (bp: number) => (bp / 10_000).toFixed(2);

/**
 * The payroll export (W6 D5): CSV or XLSX, **streamed**. Rows go to the response as each page of
 * `EXPORT_PAGE` comes back from the database, and the writer waits when the client reads slowly
 * (`drain`), so a 500-person month costs one page of memory, not the whole file.
 *
 * CSV is one view (`summary`: a row per person, or `lines`: a row per day and kind) with a BOM so
 * Excel on Windows reads it as UTF-8. XLSX carries both, as two sheets.
 *
 * Everything happens before the handler returns, so it all runs inside the request's tenant
 * transaction — the response is sent as it is written, not after.
 */
@Injectable()
export class PayrollExportService {
  constructor(private readonly periods: PayPeriodsRepository) {}

  async export(periodId: string, query: PayrollExportQuery, reply: FastifyReply): Promise<void> {
    const period = await this.periods.findById(periodId);
    if (!period) {
      throw new AppException(404, errorCodes.payPeriodNotFound, 'No such pay period.');
    }
    if (period.status !== 'approved') {
      throw new AppException(
        409,
        errorCodes.payPeriodNotCalculated,
        'Only an approved, calculated period can be exported.',
      );
    }

    const stream = new PassThrough();
    const name = `payroll-${period.startsOn}-to-${period.endsOn}`;
    if (query.format === 'xlsx') {
      void reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${name}.xlsx"`)
        .send(stream);
      await this.writeXlsx(period, stream);
    } else {
      void reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}-${query.view}.csv"`)
        .send(stream);
      await this.writeCsv(period, query.view, stream);
    }
  }

  private async writeCsv(
    period: PayPeriodRecord,
    view: 'summary' | 'lines',
    stream: PassThrough,
  ): Promise<void> {
    await write(stream, `\uFEFF${csvRow(view === 'summary' ? SUMMARY_HEADER : LINES_HEADER)}`);
    const rows = view === 'summary' ? this.summaryRows(period) : this.lineRows(period);
    for await (const row of rows) await write(stream, csvRow(row));
    stream.end();
  }

  private async writeXlsx(period: PayPeriodRecord, stream: PassThrough): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false,
    });
    workbook.creator = 'Shiftora';

    const summary = workbook.addWorksheet('Summary');
    summary.addRow(SUMMARY_HEADER).commit();
    for await (const row of this.summaryRows(period)) summary.addRow(row).commit();
    summary.commit();

    const lines = workbook.addWorksheet('Lines');
    lines.addRow(LINES_HEADER).commit();
    for await (const row of this.lineRows(period)) lines.addRow(row).commit();
    lines.commit();

    await workbook.commit();
  }

  private async *summaryRows(period: PayPeriodRecord): AsyncGenerator<string[]> {
    for (let offset = 0; ; offset += EXPORT_PAGE) {
      const page = await this.periods.summaryPage(period.id, offset, EXPORT_PAGE);
      for (const person of page) {
        yield [
          person.name,
          person.email ?? '',
          hours(person.regularMinutes),
          hours(person.overtimeMinutes),
          hours(person.nightMinutes),
          money(person.rateMinor),
          money(person.amountMinor),
          person.currency,
        ];
      }
      if (page.length < EXPORT_PAGE) return;
    }
  }

  private async *lineRows(period: PayPeriodRecord): AsyncGenerator<string[]> {
    for (let offset = 0; ; offset += EXPORT_PAGE) {
      const page = await this.periods.linesPage(period.id, offset, EXPORT_PAGE);
      for (const { line, name } of page) {
        yield [
          name,
          line.date,
          line.category === 'overtime' ? 'Overtime' : 'Regular',
          line.night ? 'Yes' : 'No',
          hours(line.minutes),
          times(line.multiplierBp),
          money(line.rateMinor),
          money(line.amountMinor),
          line.currency,
        ];
      }
      if (page.length < EXPORT_PAGE) return;
    }
  }
}

/** Quote a field with a comma, quote or newline (quotes doubled); CRLF line ends, as RFC 4180. */
function csvRow(cells: string[]): string {
  const quoted = cells.map((cell) =>
    /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
  );
  return `${quoted.join(',')}\r\n`;
}

/** Writes, and waits for the reader when the buffer is full: memory stays flat. */
async function write(stream: PassThrough, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

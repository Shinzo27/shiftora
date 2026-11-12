import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(
      toCsv([
        ['Date', 'Employee'],
        ['2026-11-12', 'Asha Mehta'],
      ]),
    ).toBe('Date,Employee\r\n2026-11-12,Asha Mehta');
  });

  it('quotes anything that would break a column', () => {
    expect(toCsv([['Mehta, Asha', 'he said "hi"', 'two\nlines']])).toBe(
      '"Mehta, Asha","he said ""hi""","two\nlines"',
    );
  });

  it('writes null as an empty cell and numbers as they are', () => {
    expect(toCsv([[null, 0, 480]])).toBe(',0,480');
  });

  it('leaves a plain name alone', () => {
    expect(toCsv([['Asha Mehta']])).toBe('Asha Mehta');
  });
});

const MAX_PDF_BYTES = 2_000_000;
const MIN_PDF_PAGES = 4;
const MAX_PDF_PAGES = 10;
const PATCHED_PDFJS_VERSION = '6.2.108';

export const SAFE_PDF_OPTIONS = Object.freeze({
  isEvalSupported: false,
  maxImageSize: 4_000_000,
  stopAtErrors: true,
  verbosity: 0,
});

const RELEASE_ROWS = Object.freeze([
  'The Employment Situation',
  'Producer Price Indexes',
  'Consumer Price Index',
  'Real Earnings',
  'Productivity and Costs',
  'Employment Cost Index',
  'U.S. Import and Export Price Indexes',
]);
const MONTHLY_RELEASE_ROWS = Object.freeze([
  'The Employment Situation',
  'Producer Price Indexes',
  'Consumer Price Index',
  'Real Earnings',
  'U.S. Import and Export Price Indexes',
]);
const COLUMN_HEADER = /^DEPT AGENCY\/INDICATORS JAN FEB MAR APR MAY JUN JUL(?:Y)? AUG SEP(?:T)? OCT NOV DEC$/;

function calendarError() {
  const error = new Error('calendar_invalid');
  error.code = 'calendar_invalid';
  return error;
}

function safeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150);
}

function validYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw calendarError();
  return year;
}

function isoDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day) throw calendarError();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizedLines(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function rowValues(lines, titleIndex, nextTitleIndex) {
  const values = lines
    .slice(titleIndex + 1, nextTitleIndex)
    .filter((line) => /^(?:--|\d{1,2})(?:\s+(?:--|\d{1,2})){11}$/.test(line));
  if (values.length !== 1) throw calendarError();
  const tokens = values[0].split(' ');
  if (tokens.length !== 12) throw calendarError();
  return tokens;
}

function validateRowCadence(title, values) {
  if (MONTHLY_RELEASE_ROWS.includes(title)) {
    if (!values.every((value) => /^\d{1,2}$/.test(value))) throw calendarError();
    return;
  }
  if (title === 'Employment Cost Index') {
    const scheduledMonths = new Set([1, 4, 7, 10]);
    const valid = values.every((value, index) => (
      scheduledMonths.has(index + 1) ? /^\d{1,2}$/.test(value) : value === '--'
    ));
    if (!valid) throw calendarError();
  }
}

function productivityValues(lines, titleIndex, nextTitleIndex, year) {
  const valueText = lines
    .slice(titleIndex + 1, nextTitleIndex)
    .filter((line) => !line.startsWith('('))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const priorYear = String(year - 1).slice(-2);
  const currentYear = String(year).slice(-2);
  const pattern = new RegExp(
    `^--\\s+(\\d{1,2})\\s+4Q\\s*'\\s*${priorYear}\\s+(\\d{1,2})\\s+4Q\\s*'\\s*${priorYear}`
      + `\\s+--\\s+(\\d{1,2})\\s+1Q\\s*'\\s*${currentYear}\\s+(\\d{1,2})\\s+1Q\\s*'\\s*${currentYear}`
      + `\\s+--\\s+(\\d{1,2})\\s+2Q\\s*'\\s*${currentYear}\\s+(\\d{1,2})\\s+2Q\\s*'\\s*${currentYear}`
      + `\\s+--\\s+(\\d{1,2})\\s+3Q\\s*'\\s*${currentYear}\\s+(\\d{1,2})\\s+3Q\\s*'\\s*${currentYear}$`,
  );
  const match = valueText.match(pattern);
  if (!match) throw calendarError();
  const values = Array(12).fill('--');
  const releaseMonths = [2, 3, 5, 6, 8, 9, 11, 12];
  releaseMonths.forEach((month, index) => { values[month - 1] = match[index + 1]; });
  return values;
}

export function parseOmbBlsText(text, source, requestedYear) {
  const year = validYear(requestedYear);
  const lines = normalizedLines(text);
  if (!lines.includes(`PRINCIPAL FEDERAL ECONOMIC INDICATORS FOR ${year}`)) throw calendarError();

  const sectionStart = lines.indexOf('BUREAU OF LABOR STATISTICS');
  const sectionEnd = lines.indexOf('FEDERAL RESERVE BOARD', sectionStart + 1);
  if (sectionStart < 0 || sectionEnd <= sectionStart) throw calendarError();
  if (lines[sectionStart - 1] !== 'LABOR' || !COLUMN_HEADER.test(lines[sectionStart - 2] || '')) {
    throw calendarError();
  }
  const section = lines.slice(sectionStart + 1, sectionEnd);

  const positions = RELEASE_ROWS.map((title) => {
    const matches = section.reduce((indexes, line, index) => (
      line === title ? [...indexes, index] : indexes
    ), []);
    if (matches.length !== 1) throw calendarError();
    return { title, index: matches[0] };
  }).sort((a, b) => a.index - b.index);

  const events = [];
  for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
    const position = positions[positionIndex];
    const nextKnownTitle = positions
      .filter(({ index }) => index > position.index)
      .reduce((nearest, { index }) => Math.min(nearest, index), section.length);
    const values = position.title === 'Productivity and Costs'
      ? productivityValues(section, position.index, nextKnownTitle, year)
      : rowValues(section, position.index, nextKnownTitle);
    validateRowCadence(position.title, values);
    const idPart = safeId(position.title);
    if (!idPart) throw calendarError();
    values.forEach((value, monthIndex) => {
      if (value === '--') return;
      const day = Number(value);
      if (!Number.isInteger(day) || day < 1 || day > 31) throw calendarError();
      const date = isoDate(year, monthIndex + 1, day);
      events.push({
        id: `${source.id}:${date}:${idPart}`,
        title: position.title,
        kind: source.kind,
        sourceId: source.id,
        sourceName: source.name,
        sourceShortName: source.shortName,
        sourceUrl: source.sourceUrl,
        date,
        endDate: date,
        startsAt: null,
        timeZone: null,
        timeStatus: 'date-only',
        timeLabel: 'Date only',
      });
    });
  }

  if (events.length !== 72) throw calendarError();
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

async function extractPdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs?.version !== PATCHED_PDFJS_VERSION) throw calendarError();
  const loadingTask = pdfjs.getDocument({ data: bytes, ...SAFE_PDF_OPTIONS });
  let document;
  try {
    document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages)
        || document.numPages < MIN_PDF_PAGES
        || document.numPages > MAX_PDF_PAGES) throw calendarError();
    const text = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        text.push(content.items
          .filter((item) => item?.str != null)
          .map((item) => `${item.str}${item.hasEOL ? '\n' : ''}`)
          .join(''));
      } finally {
        if (typeof page.cleanup === 'function') page.cleanup();
      }
    }
    return { totalPages: document.numPages, text };
  } finally {
    if (typeof loadingTask.destroy === 'function') await loadingTask.destroy();
  }
}

export async function parseOmbBlsPdf(value, source, requestedYear, options = {}) {
  const bytes = value instanceof Uint8Array ? value : null;
  if (!bytes || bytes.byteLength < 5 || bytes.byteLength > MAX_PDF_BYTES
      || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
    throw calendarError();
  }
  const extract = options.extractPdfPages || extractPdfPages;
  let extracted;
  try {
    extracted = await extract(bytes);
  } catch {
    throw calendarError();
  }
  if (!Number.isInteger(extracted?.totalPages)
      || extracted.totalPages < MIN_PDF_PAGES
      || extracted.totalPages > MAX_PDF_PAGES
      || !Array.isArray(extracted?.text)
      || extracted.text.length !== extracted.totalPages) throw calendarError();
  const matchingPages = extracted.text.filter((page) => (
    String(page || '').includes('BUREAU OF LABOR STATISTICS')
      && String(page || '').includes(`PRINCIPAL FEDERAL ECONOMIC INDICATORS FOR ${validYear(requestedYear)}`)
  ));
  if (matchingPages.length !== 1) throw calendarError();
  return parseOmbBlsText(matchingPages[0], source, requestedYear);
}

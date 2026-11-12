/**
 * Shared pieces of the two Reports screens (Phase 3E) — the owner's
 * farm-wide screen and the supervisor's department one.
 *
 * - REPORT_TYPES / PERIODS: the four types and the three period
 *   windows both screens offer (mirrors the backend's REPORT_TYPES).
 * - CSV export: the report in hand — a header (type, period, generated
 *   at, scope) followed by label/value rows — built in the browser
 *   from data already loaded, so no endpoint is involved.
 */
import { GeneratedReport } from '../../core/farm-data.service';

export const REPORT_TYPES = [
  'Daily operations summary',
  'Task performance',
  'Attendance hours',
  'Inputs & expenses',
] as const;

export const PERIODS: { value: string; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 0 },
  { value: '7d', label: 'Last 7 days', days: 6 },
  { value: 'month', label: 'This month', days: 29 },
];

const DEPT_LABELS: Record<string, string> = {
  crops: 'Crop Production',
  livestock: 'Animal Rearing',
};

/** Farm-wide for the owner's reports, the department otherwise. */
export function reportScope(report: GeneratedReport): string {
  if (!report.dept) return 'Farm-wide';
  return DEPT_LABELS[report.dept] ?? report.dept;
}

/** RFC-4180 cell: quote everything, double embedded quotes. */
function cell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The report as CSV text (CRLF rows, UTF-8 BOM for Excel). */
export function reportToCsv(report: GeneratedReport): string {
  const rows: (string | number)[][] = [
    ['Report', report.type],
    ['Period', report.period],
    ['Generated', new Date(report.when).toISOString()],
    ['Scope', reportScope(report)],
    [],
    ['Label', 'Value'],
    ...report.lines.map((line) => [line.label, line.value]),
  ];
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}`;
}

/** Downloads the report as `farmis-<type>-<period>.csv`. */
export function downloadReportCsv(report: GeneratedReport): void {
  const blob = new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `farmis-${slug(report.type)}-${slug(report.period)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

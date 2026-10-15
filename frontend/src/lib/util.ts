export const cls = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(' ');

export function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const sign = ms < 0 ? 'in ' : '';
  const suffix = ms < 0 ? '' : ' ago';
  if (abs < 60e3) return ms < 0 ? 'soon' : 'just now';
  const m = Math.round(abs / 60e3);
  if (m < 60) return `${sign}${m}m${suffix}`;
  const h = Math.round(abs / 3600e3);
  if (h < 24) return `${sign}${h}h${suffix}`;
  const d = Math.round(abs / 86400e3);
  if (d < 30) return `${sign}${d}d${suffix}`;
  const mo = Math.round(d / 30);
  return `${sign}${mo}mo${suffix}`;
}

export const isOverdue = (iso: string | null) =>
  !!iso && Date.now() > new Date(iso).getTime();

// Due-date display. Falls back to `fmtRel` for far-away, all-day
// dates; surfaces a clock time when one is set and the date is
// within ~7 days. "Has a time" = local hours/minutes both non-zero,
// which is correct for date-only inputs (which round-trip as
// midnight UTC) and for user-picked times.
export function fmtDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;

  const fmtTime = () => {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return m === 0 ? `${h}${ampm}` : `${h}:${m.toString().padStart(2, '0')}${ampm}`;
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (hasTime) {
    if (isSameDay(d, now)) return `today ${fmtTime()}`;
    if (isSameDay(d, tomorrow)) return `tomorrow ${fmtTime()}`;
    if (Math.abs(ms) < 7 * 86400e3) {
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      return `${day} ${fmtTime()}`;
    }
  }
  return fmtRel(iso);
}

// Convert an ISO timestamp to the local datetime-local input value
// "YYYY-MM-DDTHH:mm". Returns '' for null/empty so the input renders
// blank.
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

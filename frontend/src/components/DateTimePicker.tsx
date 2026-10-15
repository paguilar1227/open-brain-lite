// Hand-rolled date+time picker. Replaces <input type="datetime-local">
// because the native popup is browser-styled and impossible to reconcile
// with the rest of the UI.
//
// Behavior:
//   - Trigger button shows the formatted current value (or "No due date")
//     and toggles a popover.
//   - Popover contains: month nav + 7-col date grid (Sun-Sat), time row
//     (hour 1-12, minute 00-59, AM/PM toggle), and footer buttons:
//     Clear, Today, Done.
//   - Hour/minute fields hold a raw string while the user is typing —
//     no clamp-on-keystroke, otherwise typing "1" then "3" gets clamped
//     to 12 before "3" can land. Invalid states render with a red
//     border and disable Done; valid states canonicalize on blur (e.g.
//     a typed "5" becomes "05" for the minute slot).
//   - Internal state is a draft that only commits on Done. Clear and
//     Done close the popover; Esc cancels and returns focus to the
//     trigger; mousedown outside also cancels.
//   - Keyboard nav on the grid: ←→ ±1 day, ↑↓ ±7 days, Enter commits.
//   - On open, focus moves to the selected day cell. On close, focus
//     returns to the trigger.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from './Icons';
import { cls } from '../lib/util';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
}

interface Parts {
  date: Date;
  hour: number;          // 1..12
  minute: number;        // 0..59
  ampm: 'am' | 'pm';
}

function partsFromIso(iso: string | null): Parts {
  if (iso) {
    const d = new Date(iso);
    let h = d.getHours();
    const ampm: 'am' | 'pm' = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return {
      date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      hour: h,
      minute: d.getMinutes(),
      ampm,
    };
  }
  // Default for new picks: today at 9:00 AM. A blank canvas pre-set to
  // a reasonable working-hour beats rolling against midnight.
  const now = new Date();
  return {
    date: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    hour: 9,
    minute: 0,
    ampm: 'am',
  };
}

function isoFromParts(p: Parts): string {
  const h24 = p.ampm === 'pm' ? (p.hour % 12) + 12 : p.hour % 12;
  const out = new Date(
    p.date.getFullYear(), p.date.getMonth(), p.date.getDate(),
    h24, p.minute, 0, 0,
  );
  return out.toISOString();
}

function formatTrigger(iso: string | null): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function buildGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

// Accept any natural-number string while typing. Canonicalize / validate
// only on blur or commit.
function isValidHour(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 12;
}
function isValidMinute(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = parseInt(s, 10);
  return n >= 0 && n <= 59;
}

export function DateTimePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const seed = useMemo(() => partsFromIso(value), [value]);
  const [draftDate, setDraftDate] = useState<Date>(seed.date);
  const [hourStr, setHourStr] = useState<string>(String(seed.hour));
  const [minuteStr, setMinuteStr] = useState<string>(String(seed.minute).padStart(2, '0'));
  const [ampm, setAmpm] = useState<'am' | 'pm'>(seed.ampm);
  const [view, setView] = useState<Date>(seed.date);

  // Re-seed everything from the prop whenever the popover opens. Keeps
  // edits transient — closing without Done discards them.
  useEffect(() => {
    if (!open) return;
    const p = partsFromIso(value);
    setDraftDate(p.date);
    setHourStr(String(p.hour));
    setMinuteStr(String(p.minute).padStart(2, '0'));
    setAmpm(p.ampm);
    setView(p.date);
  }, [open, value]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Move focus to the selected day cell on open.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const cell =
        popRef.current?.querySelector<HTMLButtonElement>('.dtp-day.selected') ??
        popRef.current?.querySelector<HTMLButtonElement>('.dtp-day:not(.dim)');
      cell?.focus();
    });
  }, [open]);

  const today = new Date();
  const grid = useMemo(() => buildGrid(view), [view]);

  const moveMonth = (delta: number) =>
    setView((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const setDayDraft = (d: Date) => {
    setDraftDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  };

  const hourValid = isValidHour(hourStr);
  const minuteValid = isValidMinute(minuteStr);
  const canCommit = hourValid && minuteValid;

  const commit = () => {
    if (!canCommit) return;
    const iso = isoFromParts({
      date: draftDate,
      hour: parseInt(hourStr, 10),
      minute: parseInt(minuteStr, 10),
      ampm,
    });
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const clear = () => {
    onChange(null);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const goToToday = () => {
    const t = new Date();
    setView(new Date(t.getFullYear(), t.getMonth(), 1));
    setDayDraft(t);
  };

  // Canonicalize on blur — pad minutes to two digits when the typed
  // value is a valid single digit. Hour stays as typed (12 vs "12" is
  // the same; "3" stays "3"). Invalid states are left alone so the
  // user sees their input + the error highlight.
  const onMinuteBlur = () => {
    if (isValidMinute(minuteStr) && minuteStr.length === 1) {
      setMinuteStr(minuteStr.padStart(2, '0'));
    }
  };

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '];
    if (!handled.includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter' || e.key === ' ') {
      commit();
      return;
    }
    const delta =
      e.key === 'ArrowLeft' ? -1 :
      e.key === 'ArrowRight' ? 1 :
      e.key === 'ArrowUp' ? -7 : 7;
    const next = new Date(draftDate);
    next.setDate(next.getDate() + delta);
    setDayDraft(next);
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) {
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    requestAnimationFrame(() => {
      popRef.current?.querySelector<HTMLButtonElement>('.dtp-day.selected')?.focus();
    });
  };

  return (
    <div className="dtp-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={cls('dtp-trigger', !value && 'empty')}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icons.Calendar size={13} />
        <span className="dtp-trigger-text">{formatTrigger(value)}</span>
        <Icons.ChevronDown size={11} />
      </button>
      {open ? (
        <div
          ref={popRef}
          className="dtp-pop"
          role="dialog"
          aria-modal="false"
          aria-label="Pick due date and time"
        >
          <div className="dtp-head">
            <button
              type="button"
              className="dtp-nav"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
            >
              <Icons.ChevronLeft size={11} />
            </button>
            <div className="dtp-month">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button
              type="button"
              className="dtp-nav"
              onClick={() => moveMonth(1)}
              aria-label="Next month"
            >
              <Icons.ChevronRight size={11} />
            </button>
          </div>
          <div className="dtp-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="dtp-grid" onKeyDown={onGridKey} role="grid">
            {grid.map((d, i) => {
              const sel = isSameDay(d, draftDate);
              const dim = d.getMonth() !== view.getMonth();
              const isToday = isSameDay(d, today);
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  className={cls('dtp-day', sel && 'selected', dim && 'dim', isToday && 'today')}
                  tabIndex={sel ? 0 : -1}
                  onClick={() => setDayDraft(d)}
                  onDoubleClick={commit}
                  aria-label={d.toDateString()}
                  aria-selected={sel}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="dtp-time">
            <span className="dtp-time-label">Time</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={cls('dtp-num', !hourValid && 'invalid')}
              value={hourStr}
              onChange={(e) => setHourStr(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onFocus={(e) => e.currentTarget.select()}
              onMouseUp={(e) => e.currentTarget.select()}
              aria-label="Hour"
              aria-invalid={!hourValid}
              maxLength={2}
            />
            <span className="dtp-colon">:</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={cls('dtp-num', !minuteValid && 'invalid')}
              value={minuteStr}
              onChange={(e) => setMinuteStr(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onBlur={onMinuteBlur}
              onFocus={(e) => e.currentTarget.select()}
              onMouseUp={(e) => e.currentTarget.select()}
              aria-label="Minute"
              aria-invalid={!minuteValid}
              maxLength={2}
            />
            <div className="dtp-ampm" role="radiogroup" aria-label="AM/PM">
              {(['am', 'pm'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={ampm === m}
                  className={cls('dtp-ampm-b', ampm === m && 'active')}
                  onClick={() => setAmpm(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {!canCommit ? (
            <div className="dtp-error" role="alert">
              {!hourValid ? 'Hour must be 1–12.' : 'Minute must be 0–59.'}
            </div>
          ) : null}
          <div className="dtp-foot">
            <button type="button" className="dtp-foot-btn" onClick={clear}>Clear</button>
            <button type="button" className="dtp-foot-btn" onClick={goToToday}>Today</button>
            <button
              type="button"
              className="dtp-foot-btn primary"
              onClick={commit}
              disabled={!canCommit}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { fitInlineCount } from './fitInlineTags';

// Widths chosen to mirror the real chips: status pill ~51, tag chip ~50,
// "+N more" pill ~58, gap 4 — the same numbers the browser measured.
const LEAD = 51;
const CHIP = 50;
const MORE = 58;
const GAP = 4;

describe('fitInlineCount', () => {
  it('no chips → 0', () => {
    expect(
      fitInlineCount({ containerWidth: 999, leadWidth: 0, chipWidths: [], moreWidth: MORE, gap: GAP }),
    ).toBe(0);
  });

  it('everything fits → shows all, no "+N more" reserve', () => {
    // lead 51 + 3×(gap 4 + chip 50) = 51 + 162 = 213 ≤ 250
    const n = fitInlineCount({
      containerWidth: 250,
      leadWidth: LEAD,
      chipWidths: [CHIP, CHIP, CHIP],
      moreWidth: MORE,
      gap: GAP,
    });
    expect(n).toBe(3);
  });

  it('wide lane fits all 9 tags + leading on one line (Todos view case)', () => {
    const n = fitInlineCount({
      containerWidth: 866,
      leadWidth: LEAD,
      chipWidths: Array(9).fill(CHIP),
      moreWidth: MORE,
      gap: GAP,
    });
    expect(n).toBe(9);
  });

  it('narrow widget lane: leading + one tag + "+N more" does NOT fit → 0 tags', () => {
    // This is the bug that caused the wrap: lead 51 + gap 4 + chip 50 = 105,
    // + gap 4 + more 58 = 167 > 150 → no tag fits alongside the pill.
    const n = fitInlineCount({
      containerWidth: 150,
      leadWidth: LEAD,
      chipWidths: Array(9).fill(CHIP),
      moreWidth: MORE,
      gap: GAP,
    });
    expect(n).toBe(0);
  });

  it('reserves room for the "+N more" pill — never overfills the line', () => {
    // Without reserving the pill, 4 chips (4×50 + 3×4 = 212 ≤ 220) would
    // "fit"; but the pill must also fit, so the real answer is fewer.
    const widths = Array(9).fill(CHIP);
    const n = fitInlineCount({
      containerWidth: 220,
      leadWidth: 0,
      chipWidths: widths,
      moreWidth: MORE,
      gap: GAP,
    });
    // packed chips + gap + more must be ≤ 220
    let used = 0;
    for (let i = 0; i < n; i++) used += (i > 0 ? GAP : 0) + CHIP;
    expect(used + GAP + MORE).toBeLessThanOrEqual(220);
    // and adding one more chip would overflow
    const wouldBe = used + GAP + CHIP + GAP + MORE;
    expect(wouldBe).toBeGreaterThan(220);
  });

  it('no leading: all fit exactly at the boundary → no pill', () => {
    // 3 chips, no lead: 50 + 4 + 50 + 4 + 50 = 158
    const n = fitInlineCount({
      containerWidth: 158,
      leadWidth: 0,
      chipWidths: [CHIP, CHIP, CHIP],
      moreWidth: MORE,
      gap: GAP,
    });
    expect(n).toBe(3);
  });
});

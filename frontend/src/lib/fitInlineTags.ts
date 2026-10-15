// Pure layout math for RowTags' single-line tag fit. Given the intrinsic
// widths of the leading block, each tag chip, and the "+N more" pill, plus
// the available container width, decide how many tags fit on one line.
//
// Extracted from the component so the packing logic — the part where the
// bugs live (off-by-one overflow, forgetting to reserve the more pill) — is
// deterministically unit-testable without a real layout engine.

export interface FitInlineArgs {
  /** Available width of the row's tag lane (px). */
  containerWidth: number;
  /** Intrinsic width of the always-visible leading block, or 0 if none. */
  leadWidth: number;
  /** Intrinsic widths of the tag chips, in render order. */
  chipWidths: number[];
  /** Intrinsic width of the "+N more" pill (only relevant when overflowing). */
  moreWidth: number;
  /** Flex gap between adjacent chips (px). */
  gap: number;
}

/**
 * Number of leading tags that fit inline.
 *
 * - If the leading block + every chip fits, returns `chipWidths.length` (no
 *   "+N more" pill is needed).
 * - Otherwise greedily packs chips, always leaving room for the "+N more"
 *   pill at the end of the line, and returns how many fit (can be 0).
 */
export function fitInlineCount({
  containerWidth,
  leadWidth,
  chipWidths,
  moreWidth,
  gap,
}: FitInlineArgs): number {
  if (chipWidths.length === 0) return 0;

  // Does the leading block + every chip fit on one line? → no overflow pill.
  let total = leadWidth;
  let placed = leadWidth > 0 ? 1 : 0;
  for (const w of chipWidths) {
    total += (placed > 0 ? gap : 0) + w;
    placed++;
  }
  if (total <= containerWidth) return chipWidths.length;

  // Overflow: greedily add chips while the leading block + the chips so far
  // + the "+N more" pill still fit on one line.
  let used = leadWidth;
  let count = leadWidth > 0 ? 1 : 0;
  let fitted = 0;
  for (const w of chipWidths) {
    const tentative = used + (count > 0 ? gap : 0) + w;
    if (tentative + gap + moreWidth > containerWidth) break;
    used = tentative;
    count++;
    fitted++;
  }
  return fitted;
}

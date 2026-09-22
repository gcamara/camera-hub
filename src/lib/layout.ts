/**
 * How many tiles a window of a given width can carry. A phone answers 1 or 2; a desktop
 * browser window is three to five times wider and a single 16:9 tile there is a wall poster,
 * so the range slides up with the window instead of the phone's answer being imposed on it.
 */
export function columnChoices(width: number): number[] {
  if (width >= 1500) return [3, 4];
  if (width >= 1100) return [2, 3, 4];
  if (width >= 760) return [2, 3];
  return [1, 2];
}

/**
 * The grid's rows are `flex: 1` cells, so a short last row stretches its tiles to fill the width:
 * two cameras under a row of three come out half as large again as the ones above. Padding
 * that row with empty cells keeps every tile the same size. `null` is a spacer.
 */
export function fillLastRow<T>(items: readonly T[], columns: number): (T | null)[] {
  const remainder = columns > 1 ? items.length % columns : 0;
  const padding = remainder === 0 ? 0 : columns - remainder;
  return [...items, ...Array.from({ length: padding }, () => null)];
}

/**
 * The stored preference read through this window. It is clamped rather than overridden: a
 * choice a window can honour is always honoured, and one it cannot — two columns saved on a
 * phone, then opened on a 1920 px screen — lands on the nearest count that window does carry.
 */
export function effectiveColumns(setting: number, width: number): number {
  const choices = columnChoices(width);
  const min = choices[0] ?? 1;
  const max = choices[choices.length - 1] ?? 1;
  if (!Number.isFinite(setting)) return min;
  return Math.min(Math.max(Math.round(setting), min), max);
}

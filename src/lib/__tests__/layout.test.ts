import { columnChoices, effectiveColumns, fillLastRow } from '../layout';

describe('fillLastRow', () => {
  it('pads a short last row with spacers so its tiles keep the grid’s size', () => {
    expect(fillLastRow(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c', 'd', 'e', null]);
    expect(fillLastRow(['a', 'b', 'c'], 2)).toEqual(['a', 'b', 'c', null]);
    expect(fillLastRow(['a'], 4)).toEqual(['a', null, null, null]);
  });

  it('adds nothing to a full row, a single column or an empty grid', () => {
    expect(fillLastRow(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
    expect(fillLastRow(['a', 'b', 'c'], 1)).toEqual(['a', 'b', 'c']);
    expect(fillLastRow([], 3)).toEqual([]);
  });
});

describe('columnChoices', () => {
  it('offers a phone one or two tiles per row', () => {
    expect(columnChoices(390)).toEqual([1, 2]);
    expect(columnChoices(430)).toEqual([1, 2]);
    expect(columnChoices(759)).toEqual([1, 2]);
  });

  it('slides the range up as the window widens', () => {
    expect(columnChoices(760)).toEqual([2, 3]);
    expect(columnChoices(1100)).toEqual([2, 3, 4]);
    expect(columnChoices(1500)).toEqual([3, 4]);
    expect(columnChoices(2560)).toEqual([3, 4]);
  });

  it('never offers nothing', () => {
    for (const width of [0, 1, 320, 10000]) {
      expect(columnChoices(width).length).toBeGreaterThan(0);
    }
  });
});

describe('effectiveColumns', () => {
  it('honours a count the window can carry', () => {
    expect(effectiveColumns(1, 390)).toBe(1);
    expect(effectiveColumns(2, 390)).toBe(2);
    expect(effectiveColumns(3, 1280)).toBe(3);
    expect(effectiveColumns(4, 1920)).toBe(4);
  });

  it('opens a wide window on three columns rather than one wall-sized tile', () => {
    expect(effectiveColumns(1, 1920)).toBe(3);
    expect(effectiveColumns(2, 1920)).toBe(3);
  });

  it('brings a desktop choice back down to what a phone can show', () => {
    expect(effectiveColumns(4, 390)).toBe(2);
    expect(effectiveColumns(3, 390)).toBe(2);
  });

  it('always lands on a count the toggle actually offers', () => {
    for (const width of [320, 390, 760, 1024, 1100, 1440, 1500, 2560]) {
      for (const setting of [1, 2, 3, 4]) {
        expect(columnChoices(width)).toContain(effectiveColumns(setting, width));
      }
    }
  });

  it('falls back to the narrowest count for a width it cannot measure', () => {
    expect(effectiveColumns(Number.NaN, 1920)).toBe(3);
    expect(effectiveColumns(2.6, 390)).toBe(2);
  });
});

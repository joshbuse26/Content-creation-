/**
 * Section reorder logic — pure and unit-tested. Works on any shape with
 * `id` and `position`; returns a NEW array with contiguous positions
 * (0-based) in the new order. No-ops return the original array reference.
 */

export interface Positioned {
  id: string;
  position: number;
}

function sorted<T extends Positioned>(sections: readonly T[]): T[] {
  return [...sections].sort((a, b) => a.position - b.position);
}

function reindex<T extends Positioned>(sections: T[]): T[] {
  return sections.map((s, i) => (s.position === i ? s : { ...s, position: i }));
}

/** Move a section one step up (-1) or down (+1). */
export function moveSection<T extends Positioned>(
  sections: readonly T[],
  sectionId: string,
  direction: -1 | 1,
): T[] | readonly T[] {
  const list = sorted(sections);
  const index = list.findIndex((s) => s.id === sectionId);
  if (index === -1) return sections;
  const target = index + direction;
  if (target < 0 || target >= list.length) return sections;
  const a = list[index];
  const b = list[target];
  if (a === undefined || b === undefined) return sections;
  list[index] = b;
  list[target] = a;
  return reindex(list);
}

/** Move a section from one index to another (drag-style reorder). */
export function reorderSections<T extends Positioned>(
  sections: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] | readonly T[] {
  const list = sorted(sections);
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length
  ) {
    return sections;
  }
  const [moved] = list.splice(fromIndex, 1);
  if (moved === undefined) return sections;
  list.splice(toIndex, 0, moved);
  return reindex(list);
}

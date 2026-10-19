// Board views (`<query show:board group:status />`): which lane each note goes
// in, and what its property becomes when a card moves to another lane.
//
// A lane is one value of the group property. Values compare the way queries
// compare them (query.rs): without case, and a [[link]] by its title. A note
// whose value is a list sits in a lane per item; one without a value sits in
// the "none" lane at the end.

import { convertValue, displayText, valueText, type Property, type PropertyType, type PropertyValue } from './propertyValues';

export type Lane = {
  /** The value compared: lowercase, links by title. */
  key: string;
  /** The value as notes (or `lanes:`) write it, `[[links]]` included. */
  value: string;
  /** The value as shown. */
  label: string;
  /** The notes in this lane, in result order. */
  ids: string[];
};

type LaneNote = { id: string; properties?: Property[] };

const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/;

/** How a value shows: a link as its label or title, a checkbox as Yes or No. */
export function laneLabel(value: string, type?: PropertyType): string {
  const link = value.trim().match(LINK);
  if (link) return (link[2] ?? link[1]).trim();
  if (type === 'checkbox') return value === 'true' ? 'Yes' : 'No';
  if (type === 'percent' && value.trim() && Number.isFinite(Number(value))) return displayText({ type, value: Number(value) });
  return value.trim();
}

/** The value as lanes compare it. */
export function laneKey(value: string): string {
  const link = value.trim().match(LINK);
  return (link ? link[1] : value).trim().toLowerCase();
}

/** The values of `property` that place a note in lanes (none for an empty one). */
export function laneValues(property: Property | undefined): string[] {
  if (!property || property.type === 'raw') return [];
  if (property.type === 'list' || property.type === 'multiselect') return property.value.map((item) => item.trim()).filter(Boolean);
  const text = valueText(property).trim();
  return text ? [text] : [];
}

/** The note's property `key`, compared without case. */
export function propertyOf(note: LaneNote, key: string): Property | undefined {
  return note.properties?.find((p) => p.key.toLowerCase() === key.toLowerCase());
}

/**
 * The lanes for `notes` grouped by `group`: the ones `explicit` names first, in
 * that order (empty ones too), then the others as notes first use them. Also
 * the notes without a value.
 */
export function boardLanes(notes: LaneNote[], group: string, explicit: string[], type?: PropertyType): { lanes: Lane[]; none: string[] } {
  const lanes: Lane[] = [];
  const lane = (value: string) => {
    const key = laneKey(value);
    let found = lanes.find((l) => l.key === key);
    if (!found) {
      found = { key, value, label: laneLabel(value, type), ids: [] };
      lanes.push(found);
    }
    return found;
  };
  explicit.forEach(lane);
  const none: string[] = [];
  for (const note of notes) {
    const values = laneValues(propertyOf(note, group));
    if (!values.length) none.push(note.id);
    for (const value of values) {
      const into = lane(value);
      if (!into.ids.includes(note.id)) into.ids.push(note.id);
    }
  }
  return { lanes, none };
}

/**
 * The note's group property after its card moves from the lane `from` to the
 * lane `to` (null for the "none" lane), as `type`; null removes the property.
 * A list swaps the one item.
 */
export function movedValue(property: Property | undefined, from: string | null, to: string | null, type: Exclude<PropertyType, 'raw'>): PropertyValue | null {
  if (type === 'list' || type === 'multiselect') {
    const items = laneValues(property).filter((item) => from === null || laneKey(item) !== laneKey(from));
    if (to !== null && !items.some((item) => laneKey(item) === laneKey(to))) items.push(to);
    return items.length ? { type, value: items } : null;
  }
  if (to === null) return null;
  // Lane values use stored fractions, while the percent editor accepts 0 to 100.
  if (type === 'percent' && Number.isFinite(Number(to))) return { type, value: Number(to) };
  return convertValue({ type: 'text', value: to }, type);
}

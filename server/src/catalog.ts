/**
 * Shared MeterMate billing catalog — the single source of truth for the seeded
 * components, used by the seed script, the `/api/components` endpoint, and
 * indirectly the UI dropdown.
 *
 * NOTE on handles: Maxio component handles are globally unique *per site*. This
 * test site is shared, and the plan's bare handles (e.g. `consulting-minutes`)
 * are already taken by other components in other product families. We therefore
 * namespace our handles with an `mm-`/`metermate-` prefix so they (a) never
 * collide and (b) are unambiguously created inside our own product family.
 */
export interface MeteredComponentDef {
  handle: string;
  name: string;
  /** Singular unit of measurement, e.g. "minute". */
  unitName: string;
  /** Per-unit price in dollars. */
  unitPrice: number;
}

export const METERED_COMPONENTS: MeteredComponentDef[] = [
  {
    handle: 'metermate-consulting-minutes',
    name: 'MeterMate Consulting Minutes',
    unitName: 'minute',
    unitPrice: 2.0,
  },
];

export function formatUnitPrice(def: MeteredComponentDef): string {
  return `$${def.unitPrice.toFixed(2)}/${def.unitName}`;
}

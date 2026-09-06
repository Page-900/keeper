import {
  LAB_SLOTS,
  addressNamed,
  addressSlots,
  type AddressName,
  type AddressSlot,
} from '../shared/config.js';
import { KeeperError } from '../shared/errors.js';

export const VENUES = ['registry', 'lab'] as const;

export type Venue = (typeof VENUES)[number];

type Slots = Readonly<Record<AddressName, AddressSlot>>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const venueOfAddress = (name: AddressName): Venue =>
  LAB_SLOTS.includes(name) ? 'lab' : 'registry';

function venuesWithin(value: unknown, slots: Slots, found: Set<Venue>): Set<Venue> {
  if (typeof value === 'string' && ADDRESS.test(value)) {
    const name = addressNamed(value, slots);
    if (name !== null) found.add(venueOfAddress(name));
  }
  if (value !== null && typeof value === 'object')
    for (const nested of Object.values(value)) venuesWithin(nested, slots, found);
  return found;
}

/** Undeclared means the shared registry, so evidence written before this gate still reads. */
export function checkVenue(record: object, slots: Slots = addressSlots): Venue {
  const declared = (record as { venue?: Venue }).venue ?? 'registry';
  const found = venuesWithin(record, slots, new Set<Venue>());
  if (found.size > 1)
    throw new KeeperError('venueMixed', `one record names both deployments: ${describe(record)}`);
  for (const named of found)
    if (named !== declared)
      throw new KeeperError(
        'venueMismatch',
        `a ${declared} record names a ${named} address: ${describe(record)}`,
      );
  return declared;
}

const describe = (record: object): string => JSON.stringify(record).slice(0, 200);

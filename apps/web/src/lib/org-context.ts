import type { Location, OrgSummary } from '@shiftora/shared';
import { createContext, useContext } from 'react';

export interface OrgContextValue {
  orgId: string;
  org: OrgSummary;
  role: OrgSummary['role'];
  /** Locations this member can see (owners: all). */
  locations: Location[];
  /** The location chosen in the top-bar switcher, or null for "All locations". */
  locationId: string | null;
  selectLocation: (id: string | null) => void;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

/** The current organisation; only valid under /o/:orgId. */
export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg() used outside OrgLayout');
  return value;
}

const storageKey = (orgId: string) => `shiftora:location:${orgId}`;

/** The remembered location for an org. Storage can be blocked; then nothing is remembered. */
export function readStoredLocation(orgId: string): string | null {
  try {
    return localStorage.getItem(storageKey(orgId));
  } catch {
    return null;
  }
}

export function storeLocation(orgId: string, locationId: string | null): void {
  try {
    if (locationId) localStorage.setItem(storageKey(orgId), locationId);
    else localStorage.removeItem(storageKey(orgId));
  } catch {
    // convenience only
  }
}

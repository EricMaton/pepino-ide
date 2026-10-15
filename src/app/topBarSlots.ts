import { createContext } from 'react';

/** DOM targets the <TopBar> portals render into; the overlay layer (editor) hides the screen layer. */
export interface TopBarSlots {
  screen: HTMLElement | null;
  overlay: HTMLElement | null;
}

export const TopBarSlotsContext = createContext<TopBarSlots>({ screen: null, overlay: null });

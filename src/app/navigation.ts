import { createContext, useContext } from 'react';

export interface Navigation {
  /** True on the explorer, where the logo has nowhere to go. */
  atHome: boolean;
  /** Shows the explorer; the active project stays active. */
  goHome: () => void;
}

export const NavigationContext = createContext<Navigation>({ atHome: true, goHome: () => {} });

export const useNavigation = () => useContext(NavigationContext);

import { createContext, useContext } from 'react';

/** A button on the snackbar ("Retry"); tapping it also dismisses the snackbar. */
export interface SnackbarAction {
  label: string;
  onAction: () => void;
}

export type ShowSnackbar = (message: string, action?: SnackbarAction) => void;

export const SnackbarContext = createContext<ShowSnackbar | null>(null);

export function useSnackbar(): ShowSnackbar {
  const show = useContext(SnackbarContext);
  if (!show) throw new Error('useSnackbar must be used inside <SnackbarProvider>');
  return show;
}

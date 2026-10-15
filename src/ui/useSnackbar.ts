import { createContext, useContext } from 'react';

export type ShowSnackbar = (message: string) => void;

export const SnackbarContext = createContext<ShowSnackbar | null>(null);

export function useSnackbar(): ShowSnackbar {
  const show = useContext(SnackbarContext);
  if (!show) throw new Error('useSnackbar must be used inside <SnackbarProvider>');
  return show;
}

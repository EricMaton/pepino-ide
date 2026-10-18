import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import type { PluginPage } from './manager';

/** The running plugins' pages (#185), kept in step as plugins start, stop, install and go. */
export function usePluginPages(): PluginPage[] {
  const { plugins } = useServices();
  const [, setVersion] = useState(0);
  useEffect(() => plugins.subscribe(() => setVersion((value) => value + 1)), [plugins]);
  return plugins.pages();
}

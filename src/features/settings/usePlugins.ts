import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';

/** The plugins, kept in step with the manager (and the log as plugins write to it). */
export function usePlugins() {
  const { plugins } = useServices();
  const [, setVersion] = useState(0);
  useEffect(() => plugins.subscribe(() => setVersion((value) => value + 1)), [plugins]);
  return { entries: plugins.entries(), rejected: plugins.rejected() };
}

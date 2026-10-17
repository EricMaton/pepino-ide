import { useEffect } from 'react';
import { useServices } from '../../app/services';
import { useSnackbar } from '../../ui/useSnackbar';
import { builtinSource, loadPlugins } from './loader';

/**
 * Starts the plugins when the app starts (#48): the ones that come with
 * Pepino for now (installing more is #56). A plugin's messages show as
 * snackbars. Renders nothing.
 */
export function PluginRuntime() {
  const { plugins } = useServices();
  const showSnackbar = useSnackbar();

  useEffect(() => {
    plugins.setNotifier((text) => showSnackbar(text));
  }, [plugins, showSnackbar]);

  useEffect(() => {
    let active = true;
    loadPlugins([builtinSource()]).then(({ plugins: found, rejected }) => {
      for (const { origin, errors } of rejected) console.error(`Plugin ${origin} not loaded`, errors);
      if (active) for (const plugin of found) void plugins.start(plugin);
    }, console.error);
    return () => {
      active = false;
      void plugins.stopAll();
    };
  }, [plugins]);

  return null;
}

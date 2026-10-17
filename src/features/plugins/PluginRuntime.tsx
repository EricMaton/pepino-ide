import { useEffect } from 'react';
import { useServices } from '../../app/services';
import { useSnackbar } from '../../ui/useSnackbar';

/**
 * Starts the plugins when the app starts (#48): the ones that come with
 * Pepino for now (installing more is #56), each once it is on and its
 * permissions approved (#49). A plugin's messages show as snackbars.
 * Renders nothing.
 */
export function PluginRuntime() {
  const { plugins, pluginHost } = useServices();
  const showSnackbar = useSnackbar();

  useEffect(() => {
    pluginHost.setNotifier((text) => showSnackbar(text));
  }, [pluginHost, showSnackbar]);

  useEffect(() => {
    plugins.load().catch((error: unknown) => console.error('Cannot load the plugins', error));
    return () => void pluginHost.stopAll();
  }, [plugins, pluginHost]);

  return null;
}

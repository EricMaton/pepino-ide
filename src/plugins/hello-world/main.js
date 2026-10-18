// Pepino's smallest plugin (#46): one command, in the command palette, that says hello;
// and a page of its own (#185) that counts taps, the count kept by the plugin.
plugin.onActivate(async (api) => {
  api.commands.register('hello', async () => {
    await api.window.showMessage(`Hello, ${api.settings.get('name')}! (from a plugin)`);
  });

  let taps = (await api.storage.get('taps')) || 0;
  const tell = () => api.pages.postMessage('hello', { name: api.settings.get('name'), taps });
  api.pages.onMessage('hello', async (message) => {
    if (message && message.type === 'tap') {
      taps += 1;
      await api.storage.set('taps', taps);
    }
    await tell();
  });
});

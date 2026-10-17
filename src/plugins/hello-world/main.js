// Pepino's smallest plugin (#46): one command, in the command palette, that says hello.
plugin.onActivate((api) => {
  api.commands.register('hello', async () => {
    await api.window.showMessage(`Hello, ${api.settings.get('name')}! (from a plugin)`);
  });
});

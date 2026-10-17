// Counts the open file's words and lines (#49): a plugin that needs a permission, editor.read.
plugin.onActivate((api) => {
  api.commands.register('count', async () => {
    const text = await api.editor.getText();
    const words = text.split(/\s+/).filter(Boolean).length;
    const lines = text === '' ? 0 : text.split('\n').length;
    await api.window.showMessage(`${words} words, ${lines} lines`);
  });
});

import type { Command } from '../core/commands';

/**
 * Visible commands matching [query]: every word must appear in the title or
 * the id. Titles that start with the query come first, then titles that
 * contain it, then id-only matches. Within each group, ids starting with
 * [prefer] (the screen's own commands, e.g. `editor.`) come first; remaining
 * ties keep registration order.
 */
export function matchCommands(commands: readonly Command[], query: string, prefer?: string): Command[] {
  const visible = commands.filter((command) => !command.hidden);
  const needle = query.trim().toLowerCase();
  const preferred = (command: Command) => (prefer && command.id.startsWith(prefer) ? 0 : 1);
  const byPreference = (list: Command[]) =>
    list
      .map((command, order) => ({ command, order }))
      .sort((a, b) => preferred(a.command) - preferred(b.command) || a.order - b.order)
      .map(({ command }) => command);
  if (!needle) return byPreference(visible);
  const words = needle.split(/\s+/);

  const rank = (command: Command): number => {
    const title = command.title.toLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    if (words.every((word) => title.includes(word))) return 2;
    return 3;
  };

  return visible
    .filter((command) => {
      const haystack = `${command.title} ${command.id}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map((command, order) => ({ command, order, rank: rank(command) }))
    .sort((a, b) => a.rank - b.rank || preferred(a.command) - preferred(b.command) || a.order - b.order)
    .map(({ command }) => command);
}

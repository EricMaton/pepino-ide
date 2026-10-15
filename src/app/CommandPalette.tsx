import { useState } from 'react';
import { Button, Dialog, TextField } from '../ui/components';
import styles from './App.module.css';
import { matchCommands } from './matchCommands';
import { useServices } from './services';

export function CommandPalette({ onClose, onRun }: { onClose: () => void; onRun: (id: string) => void }) {
  const { registry } = useServices();
  const [query, setQuery] = useState('');
  const commands = matchCommands(registry.all, query);

  return (
    <Dialog title="Commands" eyebrow={`${registry.all.length} registered`} onClose={onClose}>
      <TextField
        label="Run"
        prefix=">"
        placeholder="type to filter"
        value={query}
        onChange={setQuery}
        onSubmit={() => commands[0] && onRun(commands[0].id)}
      />
      <div className={styles.paletteList}>
        {commands.map((command) => (
          <Button
            key={command.id}
            variant="text"
            listItem
            className={styles.paletteItem}
            onClick={() => onRun(command.id)}
          >
            <span className="accent" aria-hidden>
              ›
            </span>
            <span>{command.title}</span>
            <span className="caption muted">{command.id}</span>
          </Button>
        ))}
        {commands.length === 0 && <span className={`label muted ${styles.paletteEmpty}`}>NO MATCHING COMMANDS</span>}
      </div>
    </Dialog>
  );
}

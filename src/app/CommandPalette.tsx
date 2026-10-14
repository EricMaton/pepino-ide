import { useState } from 'react';
import { Button, Dialog, TextField } from '../ui/components';
import styles from './App.module.css';
import { useServices } from './services';

export function CommandPalette({ onClose, onRun }: { onClose: () => void; onRun: (id: string) => void }) {
  const { registry } = useServices();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const commands = registry.all.filter(
    (command) => command.title.toLowerCase().includes(needle) || command.id.toLowerCase().includes(needle),
  );

  return (
    <Dialog
      title="COMMAND PALETTE"
      onClose={onClose}
      actions={
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      }
    >
      <TextField
        label="FILTER"
        value={query}
        onChange={setQuery}
        onSubmit={() => commands[0] && onRun(commands[0].id)}
      />
      <div className={styles.paletteList}>
        {commands.map((command) => (
          <Button key={command.id} variant="text" listItem onClick={() => onRun(command.id)}>
            {command.title}
          </Button>
        ))}
        {commands.length === 0 && <span className={`label muted ${styles.paletteEmpty}`}>NO MATCHING COMMANDS</span>}
      </div>
    </Dialog>
  );
}

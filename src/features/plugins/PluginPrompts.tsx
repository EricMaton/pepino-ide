import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import type { PluginPrompter, QuickPickItem } from './host';
import styles from './PluginPrompts.module.css';

type QuickPickRequest = Parameters<PluginPrompter['quickPick']>[0];
type InputRequest = Parameters<PluginPrompter['input']>[0];

type Prompt = { id: number } & (
  | { kind: 'pick'; request: QuickPickRequest; answer: (index: number | null) => void }
  | { kind: 'input'; request: InputRequest; answer: (text: string | null) => void }
);

/**
 * What plugins ask the user (#53), api.window.showQuickPick and showInput:
 * one dialog at a time, in the order asked, each answered when the user
 * picks, enters, or closes it. Renders nothing while nothing is asked.
 */
export function PluginPrompts() {
  const { pluginHost } = useServices();
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  useEffect(() => {
    let asked = 0;
    const ask = (prompt: Prompt) => setPrompts((waiting) => [...waiting, prompt]);
    pluginHost.setPrompter({
      quickPick: (request) => new Promise((answer) => ask({ id: ++asked, kind: 'pick', request, answer })),
      input: (request) => new Promise((answer) => ask({ id: ++asked, kind: 'input', request, answer })),
    });
    return () => pluginHost.setPrompter(null);
  }, [pluginHost]);

  const current = prompts[0];
  if (!current) return null;
  const done = () => setPrompts((waiting) => waiting.slice(1));

  return current.kind === 'pick' ? (
    <QuickPick
      key={current.id}
      request={current.request}
      onAnswer={(index) => {
        done();
        current.answer(index);
      }}
    />
  ) : (
    <Input
      key={current.id}
      request={current.request}
      onAnswer={(text) => {
        done();
        current.answer(text);
      }}
    />
  );
}

/** A list to choose from, filtered by what is typed. */
function QuickPick({ request, onAnswer }: { request: QuickPickRequest; onAnswer: (index: number | null) => void }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = request.items
    .map((item, index): [QuickPickItem, number] => [item, index])
    .filter(([item]) => !needle || `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(needle));

  return (
    <Dialog title={request.title ?? 'Choose'} eyebrow={request.plugin.toUpperCase()} onClose={() => onAnswer(null)}>
      {request.items.length > 6 && <TextField label="Filter" value={query} onChange={setQuery} prefix=">" />}
      <div className={styles.list} role="listbox" aria-label={request.title ?? 'Choose'}>
        {shown.map(([item, index]) => (
          <button
            key={index}
            type="button"
            role="option"
            aria-selected={false}
            className={styles.row}
            onClick={() => onAnswer(index)}
          >
            <span className={cx('body', styles.label)}>{item.label}</span>
            {item.detail && <span className={cx('caption', 'muted', styles.detail)}>{item.detail}</span>}
          </button>
        ))}
        {shown.length === 0 && (
          <p className={cx('label', 'muted', styles.empty)}>{request.items.length ? 'No matches' : 'Nothing here'}</p>
        )}
      </div>
    </Dialog>
  );
}

/** A line of text to enter. */
function Input({ request, onAnswer }: { request: InputRequest; onAnswer: (text: string | null) => void }) {
  const [value, setValue] = useState(request.value ?? '');
  const submit = () => onAnswer(value);

  return (
    <Dialog
      title={request.title ?? 'Enter'}
      eyebrow={request.plugin.toUpperCase()}
      onClose={() => onAnswer(null)}
      actions={
        <>
          <Button variant="text" onClick={() => onAnswer(null)}>
            Cancel
          </Button>
          <Button variant="filled" disabled={value.trim() === ''} onClick={submit}>
            OK
          </Button>
        </>
      }
    >
      <TextField
        label={request.placeholder ? `For example: ${request.placeholder}` : 'Text'}
        value={value}
        onChange={setValue}
        autoFocus
        onSubmit={() => value.trim() !== '' && submit()}
      />
    </Dialog>
  );
}

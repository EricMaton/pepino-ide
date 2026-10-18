import { useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { Button, Dialog, TextField } from '../../ui/components';
import { cx } from '../../ui/cx';
import type { PluginPrompter, QuickPickItem } from './host';
import styles from './PluginPrompts.module.css';

type QuickPickRequest = Parameters<PluginPrompter['quickPick']>[0];
type InputRequest = Parameters<PluginPrompter['input']>[0];
type SecretRequest = Parameters<PluginPrompter['secret']>[0];
type SignInRequest = Parameters<PluginPrompter['signIn']>[0];

type Prompt = { id: number } & (
  | { kind: 'pick'; request: QuickPickRequest; answer: (index: number | null) => void }
  | { kind: 'input'; request: InputRequest; answer: (text: string | null) => void }
  | { kind: 'secret'; request: SecretRequest; answer: (text: string | true | null) => void }
  | { kind: 'signIn'; request: SignInRequest; answer: (saved: boolean) => void }
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
      secret: (request) => new Promise((answer) => ask({ id: ++asked, kind: 'secret', request, answer })),
      signIn: (request) => new Promise((answer) => ask({ id: ++asked, kind: 'signIn', request, answer })),
    });
    return () => pluginHost.setPrompter(null);
  }, [pluginHost]);

  const current = prompts[0];
  if (!current) return null;
  const done = () => setPrompts((waiting) => waiting.slice(1));

  if (current.kind === 'secret') {
    return (
      <SecretDialog
        key={current.id}
        label={current.request.label}
        plugin={current.request.plugin}
        host={current.request.host}
        help={current.request.help}
        onPaste={current.request.paste}
        onOpenHelp={current.request.openHelp}
        onAnswer={(text) => {
          done();
          current.answer(text);
        }}
      />
    );
  }

  if (current.kind === 'signIn') {
    return (
      <SignInDialog
        key={current.id}
        request={current.request}
        onAnswer={(saved) => {
          done();
          current.answer(saved);
        }}
      />
    );
  }

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

/**
 * A key of the user's own for a plugin (#186), guided (#190): where to get
 * one, then Paste (the native side reads the clipboard and keeps it, so it
 * never passes through here) or typed hidden. Pepino keeps it encrypted
 * and sends it only to [host]: the plugin never sees it.
 */
export function SecretDialog({
  label,
  plugin,
  host,
  help,
  replacing = false,
  onPaste,
  onOpenHelp,
  onAnswer,
}: {
  label: string;
  plugin: string;
  host: string;
  help?: string;
  /** One is saved already: this one takes its place. */
  replacing?: boolean;
  /** Keeps the clipboard's key; it fails when there is none. */
  onPaste?: () => Promise<void>;
  onOpenHelp?: () => Promise<void>;
  /** The key typed; true when it was pasted (kept already); null when dismissed. */
  onAnswer: (text: string | true | null) => void;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const ready = value.trim() !== '';
  const site = help?.replace(/^https:\/\//, '').split('/')[0];
  return (
    <Dialog
      title={replacing ? `Change your ${label}` : `Your ${label}`}
      eyebrow={plugin.toUpperCase()}
      onClose={() => onAnswer(null)}
      actions={
        <>
          <Button variant="text" onClick={() => onAnswer(null)}>
            Cancel
          </Button>
          {ready ? (
            <Button variant="filled" onClick={() => onAnswer(value)}>
              Save
            </Button>
          ) : (
            onPaste && (
              <Button
                variant="filled"
                onClick={() =>
                  onPaste().then(
                    () => onAnswer(true),
                    (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
                  )
                }
              >
                Paste key
              </Button>
            )
          )}
        </>
      }
    >
      {help && (
        <ol className={styles.steps}>
          <li className="body">
            Open {site} and sign in to your account{onOpenHelp ? ':' : '.'}
            {onOpenHelp && (
              <Button variant="outlined" className={styles.stepAction} onClick={() => void onOpenHelp()}>
                Open {site}
              </Button>
            )}
          </li>
          <li className="body">Create a key, and copy it.</li>
          <li className="body">Come back here and tap Paste key.</li>
        </ol>
      )}
      {problem && <p className={cx('caption', styles.problem)}>{problem}</p>}
      <TextField
        label={onPaste ? `Or type your ${label}` : label}
        value={value}
        onChange={setValue}
        hidden
        onSubmit={() => ready && onAnswer(value)}
      />
      <p className="caption muted">
        Your own: Pepino keeps it encrypted on this phone and sends it only to {host}. {plugin} never sees it.
      </p>
    </Dialog>
  );
}

/**
 * Signing in to an AI account in the browser (#190): while the user does,
 * this waits, and [request.run] ends once the key is kept. Cancel stops it;
 * a failure can be tried again.
 */
function SignInDialog({ request, onAnswer }: { request: SignInRequest; onAnswer: (saved: boolean) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  // The latest answer, so a new one each render does not start signing in again
  const answer = useRef(onAnswer);
  useEffect(() => {
    answer.current = onAnswer;
  });

  useEffect(() => {
    const controller = new AbortController();
    request.run(controller.signal).then(
      () => !controller.signal.aborted && answer.current(true),
      (error: unknown) =>
        !controller.signal.aborted && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => controller.abort();
  }, [request, attempt]);

  const provider = request.provider === 'openrouter' ? 'OpenRouter' : request.provider;
  return (
    <Dialog
      title={`Sign in with ${provider}`}
      eyebrow={request.plugin.toUpperCase()}
      onClose={() => onAnswer(false)}
      actions={
        <>
          <Button variant="text" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          {problem && (
            <Button
              variant="filled"
              onClick={() => {
                setProblem(null);
                setAttempt((count) => count + 1);
              }}
            >
              Try again
            </Button>
          )}
        </>
      }
    >
      {problem ? (
        <p className={cx('body', styles.problem)}>{problem}</p>
      ) : (
        <p className="body cursor">
          Continue in your browser: sign in to {provider} (or create an account) and allow Pepino. You come back here on
          your own.
        </p>
      )}
      <p className="caption muted">
        {provider} gives Pepino a key of your own, kept encrypted on this phone; {request.plugin} never sees it. You pay{' '}
        {provider} for what you use.
      </p>
    </Dialog>
  );
}

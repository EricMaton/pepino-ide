import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';
import { useBackHandler } from './back';
import styles from './components.module.css';
import { cx } from './cx';
import { CloseIcon } from './icons';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'outlined' | 'text' | 'filled';
  tone?: 'default' | 'danger';
  /** Full-width, left-aligned row in a list (implies the text variant look). */
  listItem?: boolean;
  /** 48×48 icon button; pass an aria-label. */
  square?: boolean;
};

export function Button({
  variant = 'outlined',
  tone = 'default',
  listItem = false,
  square = false,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'label',
        styles.button,
        styles[variant],
        tone === 'danger' && styles.danger,
        listItem && styles.listItem,
        square && styles.square,
        className,
      )}
      {...props}
    />
  );
}

export function Divider({ subtle = false }: { subtle?: boolean }) {
  return <hr className={cx(styles.divider, subtle && styles.subtle)} />;
}

export function RedBar() {
  return <div className={styles.redBar} />;
}

interface DialogProps {
  title: string;
  /** Small context line above the title, e.g. where an action applies. */
  eyebrow?: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}

/**
 * Modal dialog, open while mounted. Built on <dialog> so focus is trapped and
 * Escape closes it; the Android back button, the × and backdrop taps close it too.
 */
export function Dialog({ title, eyebrow, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // showModal() focuses the first input, popping the keyboard; only fields that ask for it get focus
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    return () => dialog.close();
  }, []);
  useBackHandler(true, onClose);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.dialogPanel}>
        <header className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            {eyebrow && <span className="caption muted ellipsis">{eyebrow}</span>}
            <h2 id={titleId} className="title ellipsis">
              {title}
            </h2>
          </div>
          <Button variant="text" square aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </Button>
        </header>
        {children !== undefined && <div className={styles.dialogContent}>{children}</div>}
        {actions !== undefined && <div className={styles.dialogActions}>{actions}</div>}
      </div>
    </dialog>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** Also applies when the field opens inside a <Dialog>. */
  autoFocus?: boolean;
  /** Called on Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  /** Prompt glyph shown before the input, e.g. '>'. */
  prefix?: string;
  /** The on-screen keyboard to show, e.g. 'email'. */
  inputMode?: 'text' | 'email';
  /** A multi-line field of this many rows (Enter adds a line; [onSubmit] is not called). */
  rows?: number;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  autoFocus,
  onSubmit,
  placeholder,
  prefix,
  inputMode,
  rows,
}: TextFieldProps) {
  const id = useId();
  const shared = {
    id,
    value,
    placeholder,
    autoFocus,
    'data-autofocus': autoFocus || undefined,
    autoCapitalize: 'off',
    autoCorrect: 'off',
    autoComplete: 'off',
    spellCheck: false,
    'aria-invalid': Boolean(error),
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="label muted">
        {label}
      </label>
      <div className={cx(styles.inputBox, error && styles.invalid)}>
        {prefix && (
          <span className={cx('body', styles.prefix)} aria-hidden>
            {prefix}
          </span>
        )}
        {rows ? (
          <textarea
            {...shared}
            rows={rows}
            className={cx('body', styles.input, styles.multiline)}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            {...shared}
            inputMode={inputMode}
            className={cx('body', styles.input)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onSubmit) {
                event.preventDefault();
                onSubmit();
              }
            }}
            enterKeyHint="done"
          />
        )}
      </div>
      {error && <span className={cx('label', styles.fieldError)}>✕ {error}</span>}
    </div>
  );
}

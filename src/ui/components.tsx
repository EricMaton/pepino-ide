import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';
import { useBackHandler } from './back';
import styles from './components.module.css';
import { cx } from './cx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'outlined' | 'text' | 'filled';
  tone?: 'default' | 'danger';
  /** Full-width, left-aligned row in a list (implies the text variant look). */
  listItem?: boolean;
};

export function Button({ variant = 'outlined', tone = 'default', listItem = false, className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'label',
        styles.button,
        variant === 'outlined' && styles.outlined,
        variant === 'filled' && styles.filled,
        tone === 'danger' && styles.danger,
        listItem && styles.listItem,
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
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}

/**
 * Modal dialog, open while mounted. Built on <dialog> so focus is trapped and
 * Escape closes it; the Android back button and backdrop taps close it too.
 */
export function Dialog({ title, onClose, children, actions }: DialogProps) {
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
        <h2 id={titleId} className={cx('title', 'ellipsis', styles.dialogTitle)}>
          {title}
        </h2>
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
}

export function TextField({ label, value, onChange, error, autoFocus, onSubmit, placeholder }: TextFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="label muted">
        {label}
      </label>
      <input
        id={id}
        className={cx('body', 'mono', styles.input, error && styles.invalid)}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-invalid={Boolean(error)}
      />
      {error && <span className={cx('label', styles.fieldError)}>{error}</span>}
    </div>
  );
}

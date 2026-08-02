import * as React from 'react';

interface Readonly_TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly type?: 'text' | 'email' | 'password' | 'tel' | 'url';
  readonly name?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Forwarded ref to the underlying `<input>`. Used by react-hook-form's `register().ref`. */
  readonly inputRef?: React.Ref<HTMLInputElement>;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** Leading icon shown inside the input on the left. Auto-sized to `h-5 w-5`. */
  readonly icon?: React.ReactElement<{ className?: string }>;
  /** Optional trailing element (e.g. visibility toggle button). */
  readonly trailing?: React.ReactNode;
  readonly className?: string;
  readonly maxLength?: number;
  /** Error message rendered beneath the input in safety-red. */
  readonly error?: string;
}

export type TextFieldProps = Readonly<Readonly_TextFieldProps>;

/**
 * Labeled form input with consistent typography, padding, and focus states.
 * Eyebrow-style uppercase label above; input below with optional leading
 * icon inside and optional trailing slot (visibility toggle, clear button, etc.).
 *
 * Integrates with react-hook-form via `name` + `onChange` + `onBlur` + `inputRef`
 * — spread `register('field')` onto these four props.
 *
 * Honors the design rule documented in `docs/DESIGN.md` §7 — all form inputs
 * use this primitive so labels, padding, and focus rings stay consistent.
 */
export function TextField({
  id,
  label,
  type = 'text',
  name,
  value,
  defaultValue,
  onChange,
  onBlur,
  inputRef,
  placeholder,
  autoComplete,
  required,
  disabled,
  icon,
  trailing,
  className = '',
  maxLength,
  error,
}: TextFieldProps) {
  const sizedIcon = icon
    ? React.cloneElement(icon, {
        className: `${icon.props.className ?? ''} h-5 w-5`.trim(),
      })
    : null;

  const inputPadLeft = icon ? 'pl-12' : 'pl-4';
  const inputPadRight = trailing ? 'pr-12' : 'pr-4';

  return (
    <div className={`flex flex-col ${className}`.trim()}>
      <label
        htmlFor={id}
        className="mb-2 ms-1 text-[11px] font-medium uppercase tracking-widest text-fg-muted"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        {sizedIcon ? (
          <span className="pointer-events-none absolute left-4 text-fg-muted">{sizedIcon}</span>
        ) : null}
        <input
          id={id}
          type={type}
          name={name}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          onBlur={onBlur}
          ref={inputRef}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full rounded-lg border bg-surface py-3 ${inputPadLeft} ${inputPadRight} text-[15px] text-fg placeholder:text-fg-muted transition-colors focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${
            error
              ? 'border-safety-red focus:border-safety-red focus:ring-safety-red'
              : 'border-border focus:border-amber-warm focus:ring-amber-warm'
          }`}
        />
        {trailing ? (
          <span className="absolute right-4 flex items-center">{trailing}</span>
        ) : null}
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 ms-1 text-xs text-safety-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FreetypeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

export function FreetypeInput({
  value,
  onChange,
  placeholder = 'Or type your own…',
  multiline = false,
}: FreetypeInputProps) {
  const sharedClass =
    'w-full rounded-md border border-border bg-bg px-4 py-3 font-sans text-sm ' +
    'text-fg placeholder:text-fg-muted/70 ' +
    'focus:border-amber-warm/60 focus:outline-none ' +
    'focus-visible:outline focus-visible:outline-focus-indicator ' +
    'focus-visible:outline-offset-focus-indicator ' +
    'transition-colors duration-fast';

  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={sharedClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={sharedClass}
    />
  );
}

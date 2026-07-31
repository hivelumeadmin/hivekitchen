import { useState } from 'react';
import { AddCircleIcon } from '@hivekitchen/ui';

interface Readonly_AddItemComposerProps {
  readonly placeholder: string;
  readonly buttonLabel: string;
  readonly onAdd?: (item: string) => void;
}

export type AddItemComposerProps = Readonly<Readonly_AddItemComposerProps>;

export function AddItemComposer({
  placeholder,
  buttonLabel,
  onAdd,
}: AddItemComposerProps) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    onAdd?.(value.trim());
    setValue('');
  };
  return (
    <div className="mb-10 flex items-center gap-1 rounded border border-border/30 bg-surface-2 p-1 shadow-sm">
      <div className="flex min-w-0 flex-grow items-center px-2 sm:px-4">
        <AddCircleIcon className="me-2 h-5 w-5 flex-shrink-0 text-fg-muted sm:me-3" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full min-w-0 border-none bg-transparent text-fg placeholder:text-fg-muted/50 focus:outline-none focus:ring-0"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        className="flex-shrink-0 whitespace-nowrap rounded bg-amber-warm px-4 py-3 text-sm font-bold text-bg transition-colors hover:bg-amber sm:px-6"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

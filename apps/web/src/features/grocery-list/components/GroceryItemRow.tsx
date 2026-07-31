import { useState } from 'react';
import {
  CheckIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from '@hivekitchen/ui';
import type { GroceryItem } from '../data/mockData.js';

interface Readonly_GroceryItemRowProps {
  readonly item: GroceryItem;
}

export type GroceryItemRowProps = Readonly<Readonly_GroceryItemRowProps>;

export function GroceryItemRow({ item }: GroceryItemRowProps) {
  const [checked, setChecked] = useState(item.checked ?? false);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unit, setUnit] = useState(item.defaultUnit);

  const containerClass = item.faded
    ? 'flex flex-wrap items-center gap-x-4 gap-y-3 rounded border border-border/30 bg-surface p-5 opacity-60'
    : 'group flex flex-wrap items-center gap-x-4 gap-y-3 rounded border border-border/30 bg-surface p-5 transition-all hover:border-amber-warm';

  const checkBorderClass = item.faded
    ? 'border-border'
    : 'border-border group-hover:border-amber-warm';

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={() => setChecked((s) => !s)}
        aria-label={checked ? 'Mark as not found' : 'Mark as found'}
        aria-pressed={checked}
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${checkBorderClass}`}
      >
        <CheckIcon
          className={`h-5 w-5 transition-opacity ${checked ? 'text-amber-warm opacity-100' : 'opacity-0'}`}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-sacred">{item.name}</p>
        <p className="truncate text-sm text-fg-muted">{item.sub}</p>
      </div>

      <div className="flex w-full flex-shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
        <div className="flex flex-shrink-0 items-center rounded border border-border/30 bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(0, q - 1))}
            aria-label="Decrease quantity"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center hover:text-amber-warm"
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[2ch] px-2 text-center text-sm font-bold">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Increase quantity"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center hover:text-amber-warm"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          aria-label={`Unit for ${item.name}`}
          className="min-w-0 flex-shrink rounded border border-border/30 bg-surface-2 px-3 py-1.5 pe-8 text-xs font-medium uppercase tracking-widest focus:border-amber-warm focus:ring-amber-warm"
        >
          {item.units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          className="ms-auto flex-shrink-0 text-fg-muted transition-colors hover:text-safety-red sm:ms-2"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

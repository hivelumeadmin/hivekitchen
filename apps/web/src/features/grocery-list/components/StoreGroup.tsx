import {
  ShoppingBasketIcon,
  StorefrontIcon,
} from '@hivekitchen/ui';
import type { Store, StoreAccent, StoreIcon } from '../data/mockData.js';
import { GroceryItemRow } from './GroceryItemRow.js';

interface Readonly_StoreGroupProps {
  readonly store: Store;
}

export type StoreGroupProps = Readonly<Readonly_StoreGroupProps>;

const accentTextClass: Record<StoreAccent, string> = {
  'safety-cleared': 'text-safety-cleared',
  amber: 'text-amber-warm',
};

const accentBgClass: Record<StoreAccent, string> = {
  'safety-cleared': 'bg-safety-cleared/10 text-safety-cleared',
  amber: 'bg-amber-warm/10 text-amber-warm',
};

export function StoreGroup({ store }: StoreGroupProps) {
  return (
    <section>
      <div
        className={`mb-6 flex flex-wrap items-center gap-2 ${accentTextClass[store.accent]}`}
      >
        <StoreHeadIcon kind={store.icon} />
        <h3 className="min-w-0 break-words font-serif text-2xl">{store.name}</h3>
        {store.badge ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${accentBgClass[store.accent]}`}
          >
            {store.badge}
          </span>
        ) : null}
      </div>
      <div className="space-y-8">
        {store.subsections.map((sub) => (
          <div key={sub.title}>
            <h4 className="mb-4 border-b border-border pb-1 text-[11px] font-medium uppercase tracking-widest text-fg-muted">
              {sub.title}
            </h4>
            <div className="space-y-4">
              {sub.items.map((item) => (
                <GroceryItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoreHeadIcon({ kind }: Readonly<{ readonly kind: StoreIcon }>) {
  const className = 'h-6 w-6 flex-shrink-0';
  if (kind === 'storefront') return <StorefrontIcon className={className} />;
  return <ShoppingBasketIcon className={className} />;
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListSnackSkusResponseSchema, SnackSkuSchema } from '@hivekitchen/contracts';
import type { SnackSku, SnackCategory, SnackPackageType, SnackAllergenTag } from '@hivekitchen/types';
import { hkFetch, HkApiError } from '@/lib/fetch.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';

type LoadState = 'loading' | 'ready' | 'error';

const ERROR_COPY = "Lumi couldn't load your snacks right now. Try refreshing.";

const CATEGORIES: readonly { value: SnackCategory; label: string }[] = [
  { value: 'fruit', label: 'Fruit' },
  { value: 'vegetable', label: 'Vegetable' },
  { value: 'grain', label: 'Grain' },
  { value: 'protein', label: 'Protein' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'other', label: 'Other' },
];

// Story 3-s43 — FALCPA-9 allergen tags. Selecting a tag declares the SKU
// contains that allergen; the commit-time guardrail and the snack-rotation
// pre-filter use these tags to keep allergic children safe.
const ALLERGENS: readonly { value: SnackAllergenTag; label: string }[] = [
  { value: 'peanut', label: 'Peanut' },
  { value: 'tree_nut', label: 'Tree nut' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'egg', label: 'Egg' },
  { value: 'wheat', label: 'Wheat' },
  { value: 'soy', label: 'Soy' },
  { value: 'fish', label: 'Fish' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'sesame', label: 'Sesame' },
];

const PACKAGE_TYPES: readonly { value: SnackPackageType; label: string }[] = [
  { value: 'bag', label: 'Bag' },
  { value: 'box', label: 'Box' },
  { value: 'cup', label: 'Cup' },
  { value: 'pouch', label: 'Pouch' },
  { value: 'other', label: 'Other' },
];

export default function SnackShelfRoute() {
  useLumiContext({ surface: 'general' });

  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isPrimaryParent = role === 'primary_parent';
  const didLoad = useRef(false);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [items, setItems] = useState<SnackSku[]>([]);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<SnackCategory>('fruit');
  const [upcCode, setUpcCode] = useState('');
  const [packageType, setPackageType] = useState<SnackPackageType | ''>('');
  const [selectedAllergens, setSelectedAllergens] = useState<SnackAllergenTag[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      navigate('/auth/login?next=/app/kitchen/snacks', { replace: true });
      return;
    }
    if (householdId === null || didLoad.current) return;
    didLoad.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/households/${householdId}/snacks`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = ListSnackSkusResponseSchema.parse(raw);
        setItems(parsed.items);
        setLoadState('ready');
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/app/kitchen/snacks', { replace: true });
          return;
        }
        didLoad.current = false;
        setLoadState('error');
      }
    })();
    return () => {
      controller.abort();
      didLoad.current = false;
    };
  }, [accessToken, householdId, navigate]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (householdId === null || name.trim().length === 0) return;
    setAddError(null);
    setAdding(true);
    try {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId}/snacks`, {
        method: 'POST',
        body: {
          name: name.trim(),
          brand: brand.trim() || undefined,
          category,
          upc_code: upcCode.trim() || undefined,
          package_type: packageType || undefined,
          allergen_tags: selectedAllergens,
        },
      });
      const created = SnackSkuSchema.parse(raw);
      setItems((prev) => [...prev, created]);
      setName('');
      setBrand('');
      setCategory('fruit');
      setUpcCode('');
      setPackageType('');
      setSelectedAllergens([]);
    } catch {
      setAddError('Could not add that snack. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleStock(skuId: string, nextInStock: boolean) {
    if (householdId === null) return;
    setToggleError(null);
    setTogglingId(skuId);
    try {
      const raw = await hkFetch<unknown>(`/v1/households/${householdId}/snacks/${skuId}`, {
        method: 'PATCH',
        body: { in_stock: nextInStock },
      });
      const updated = SnackSkuSchema.parse(raw);
      setItems((prev) => prev.map((item) => (item.id === skuId ? updated : item)));
    } catch {
      setToggleError('Could not update that snack. Please try again.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRemove(skuId: string) {
    if (householdId === null) return;
    setRemoveError(null);
    setRemovingId(skuId);
    try {
      await hkFetch(`/v1/households/${householdId}/snacks/${skuId}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((item) => item.id !== skuId));
    } catch {
      setRemoveError('Could not remove that snack. Please try again.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-grow px-4 py-16 sm:px-6 md:py-24">
      <h1 className="font-serif text-3xl text-fg">My Snacks</h1>
      <p className="mt-2 font-sans text-base text-fg-muted leading-relaxed">
        The snacks Lumi rotates through your weekly plan. Add the ones you actually buy.
      </p>

      {loadState === 'loading' ? (
        <div role="status" aria-label="Loading your snacks" className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded bg-surface animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : loadState === 'error' ? (
        <p role="alert" className="mt-8 font-sans text-base text-fg-muted">
          {ERROR_COPY}
        </p>
      ) : (
        <>
          <ul className="mt-8 space-y-3">
            {items.map((item) => {
              const isBuiltIn = item.created_by_household_id === null;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 border-b border-[color-mix(in_srgb,var(--border)_20%,transparent)] pb-3"
                >
                  <span className={item.in_stock ? undefined : 'opacity-50'}>
                    <span className="font-sans text-sm text-fg">{item.name}</span>
                    {item.brand && (
                      <span className="ms-2 font-sans text-xs text-fg-muted">{item.brand}</span>
                    )}
                    {item.upc_code && (
                      <span className="ms-2 font-sans text-xs text-fg-muted">{item.upc_code}</span>
                    )}
                    {item.package_type && (
                      <span className="ms-2 font-sans text-xs text-fg-muted">
                        {PACKAGE_TYPES.find((p) => p.value === item.package_type)?.label ??
                          item.package_type}
                      </span>
                    )}
                    {isBuiltIn && (
                      <span className="ms-2 font-sans text-xs text-fg-muted">(built-in)</span>
                    )}
                    {!item.in_stock && (
                      <span className="ms-2 font-sans text-xs text-fg-muted">(out of stock)</span>
                    )}
                  </span>
                  {!isBuiltIn && isPrimaryParent && (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleStock(item.id, !item.in_stock)}
                        disabled={togglingId === item.id}
                        className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
                      >
                        {togglingId === item.id
                          ? 'Saving…'
                          : item.in_stock
                            ? 'Mark out of stock'
                            : 'Mark in stock'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemove(item.id)}
                        disabled={removingId === item.id}
                        className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
                      >
                        {removingId === item.id ? 'Removing…' : 'Remove'}
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {removeError && (
            <p role="alert" className="mt-4 font-sans text-sm text-safety-red">
              {removeError}
            </p>
          )}

          {toggleError && (
            <p role="alert" className="mt-4 font-sans text-sm text-safety-red">
              {toggleError}
            </p>
          )}

          {isPrimaryParent && (
            <section className="mt-12 border-t border-border pt-8">
              <h2 className="font-serif text-xl text-fg">Add a snack</h2>
              <form onSubmit={handleAdd} className="mt-4 space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="snack-name" className="block text-sm">
                    Name
                  </label>
                  <input
                    id="snack-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    required
                    className="w-full rounded border border-border px-3 py-2"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="snack-brand" className="block text-sm">
                    Brand (optional)
                  </label>
                  <input
                    id="snack-brand"
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    maxLength={100}
                    className="w-full rounded border border-border px-3 py-2"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="snack-upc" className="block text-sm">
                    UPC (optional)
                  </label>
                  <input
                    id="snack-upc"
                    type="text"
                    value={upcCode}
                    onChange={(e) => setUpcCode(e.target.value)}
                    maxLength={20}
                    className="w-full rounded border border-border px-3 py-2"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="snack-category" className="block text-sm">
                    Category
                  </label>
                  <select
                    id="snack-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as SnackCategory)}
                    className="w-full rounded border border-border px-3 py-2"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="snack-package-type" className="block text-sm">
                    Package type (optional)
                  </label>
                  <select
                    id="snack-package-type"
                    value={packageType}
                    onChange={(e) => setPackageType(e.target.value as SnackPackageType | '')}
                    className="w-full rounded border border-border px-3 py-2"
                  >
                    <option value="">Not specified</option>
                    {PACKAGE_TYPES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="space-y-2">
                  <legend className="block text-sm">Allergens (optional)</legend>
                  <p className="font-sans text-xs text-fg-muted">
                    Tell Lumi which allergens this snack contains so it’s never sent to a child who
                    can’t have it.
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ALLERGENS.map((a) => {
                      const checked = selectedAllergens.includes(a.value);
                      return (
                        <label key={a.value} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedAllergens((prev) =>
                                e.target.checked
                                  ? [...prev, a.value]
                                  : prev.filter((v) => v !== a.value),
                              )
                            }
                          />
                          {a.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {addError && (
                  <p role="alert" className="text-sm text-safety-red">
                    {addError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={adding || name.trim().length === 0}
                  className="rounded bg-amber-warm px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-amber motion-reduce:transition-none disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add snack'}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}

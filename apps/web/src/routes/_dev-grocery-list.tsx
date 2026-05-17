import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { LumiFAB } from '../components/LumiFAB.js';
import { AddItemComposer } from '../features/grocery-list/components/AddItemComposer.js';
import { GroceryHero } from '../features/grocery-list/components/GroceryHero.js';
import { LumiHint } from '../features/grocery-list/components/LumiHint.js';
import { StoreGroup } from '../features/grocery-list/components/StoreGroup.js';
import { StoreSession } from '../features/grocery-list/components/StoreSession.js';
import { groceryListMock } from '../features/grocery-list/data/mockData.js';

export function DevGroceryListPage() {
  const m = groceryListMock;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-grow px-4 pb-32 pt-8 sm:px-6">
        <GroceryHero
          eyebrow={m.hero.eyebrow}
          headline={m.hero.headline}
          description={m.hero.description}
          imageSrc={m.hero.imageSrc}
          imageAlt={m.hero.imageAlt}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-12 lg:col-span-8">
            <LumiHint text={m.lumiHint} />
            <AddItemComposer
              placeholder={m.composer.placeholder}
              buttonLabel={m.composer.buttonLabel}
            />
            {m.stores.map((store) => (
              <StoreGroup key={store.name} store={store} />
            ))}
          </div>
          <div className="lg:col-span-4">
            <StoreSession {...m.session} />
          </div>
        </div>
      </main>
      <LumiFAB notification />
      <AppFooter />
    </div>
  );
}

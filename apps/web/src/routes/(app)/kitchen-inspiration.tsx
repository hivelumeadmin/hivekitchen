import { LumiFAB } from '@/components/LumiFAB.js';
import { InspirationActions } from '@/features/kitchen-inspiration/components/InspirationActions.js';
import { InspirationHeader } from '@/features/kitchen-inspiration/components/InspirationHeader.js';
import { RecipeCard } from '@/features/kitchen-inspiration/components/RecipeCard.js';
import { kitchenInspirationMock } from '@/features/kitchen-inspiration/data/mockData.js';

export default function KitchenInspirationRoute() {
  const m = kitchenInspirationMock;
  return (
    <>
      <main className="mx-auto w-full max-w-7xl flex-grow px-4 pb-32 pt-12 sm:px-6">
        <InspirationHeader
          title={m.header.title}
          description={m.header.description}
          statusLabel={m.header.statusLabel}
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-12">
          {m.recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>

        <InspirationActions
          loadMoreLabel={m.actions.loadMoreLabel}
          notTheseLabel={m.actions.notTheseLabel}
          talkToLumiLabel={m.actions.talkToLumiLabel}
        />
      </main>
      <LumiFAB />
    </>
  );
}

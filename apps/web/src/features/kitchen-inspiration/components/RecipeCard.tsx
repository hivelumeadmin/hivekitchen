import type { Recipe } from '../data/mockData.js';
import { RecipeBadge } from './RecipeBadge.js';

interface Readonly_RecipeCardProps {
  readonly recipe: Recipe;
  readonly onSelect?: () => void;
}

export type RecipeCardProps = Readonly<Readonly_RecipeCardProps>;

export function RecipeCard({ recipe, onSelect }: RecipeCardProps) {
  const spanClass =
    recipe.variant === 'large' ? 'lg:col-span-8' : 'lg:col-span-4';
  const titleClass =
    recipe.variant === 'large'
      ? 'font-serif text-[34px] leading-snug text-fg'
      : 'font-serif text-2xl leading-tight text-fg md:text-[28px]';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`group flex flex-col overflow-hidden rounded-xl border border-border bg-surface p-6 transition-transform duration-300 hover:-translate-y-1 ${spanClass}`}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {recipe.badges.map((badge, i) => (
          <RecipeBadge key={i} badge={badge} />
        ))}
      </div>
      <h2 className={`mb-3 ${titleClass}`}>{recipe.title}</h2>
      <p className="mb-6 text-[15px] leading-relaxed text-fg-muted">{recipe.body}</p>
      <div className="mt-auto border-l-2 border-lumi-terracotta py-2 ps-4">
        {recipe.variant === 'large' ? (
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-widest text-lumi-terracotta">
            Lumi&apos;s reasoning
          </span>
        ) : null}
        <blockquote className="font-serif text-[22px] italic leading-snug text-fg md:text-[26px]">
          {recipe.reasoning}
        </blockquote>
      </div>
    </div>
  );
}

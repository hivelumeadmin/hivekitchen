import { RailCard } from '../../../components/RailCard.js';

interface MealPreview {
  readonly name: string;
  readonly allergens: readonly string[];
}

interface Readonly_MealPreviewCardProps {
  readonly childName: string;
  readonly meal: MealPreview;
}

export type MealPreviewCardProps = Readonly<Readonly_MealPreviewCardProps>;

export function MealPreviewCard({ childName, meal }: MealPreviewCardProps) {
  return (
    <RailCard
      eyebrow={
        <>
          What <span className="text-sacred">{childName}</span> is having today
        </>
      }
    >
      <div className="mb-4 h-32 w-full overflow-hidden rounded-md bg-surface-2">
        <img
          src="/images/meal-cumin-chicken-pita.jpg"
          alt={meal.name}
          className="h-full w-full object-cover"
        />
      </div>
      <p className="mb-2 font-serif text-lg text-fg">{meal.name}</p>
      <div className="flex flex-wrap gap-2">
        {meal.allergens.map((label) => (
          <span
            key={label}
            className="rounded border border-safety-red/20 bg-safety-red/10 px-2 py-0.5 text-[11px] font-bold uppercase text-safety-red"
          >
            {label}
          </span>
        ))}
      </div>
    </RailCard>
  );
}

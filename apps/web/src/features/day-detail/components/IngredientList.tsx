interface Readonly_IngredientListProps {
  readonly ingredients: readonly string[];
}

export type IngredientListProps = Readonly<Readonly_IngredientListProps>;

export function IngredientList({ ingredients }: IngredientListProps) {
  return (
    <section className="space-y-6">
      <h2 className="font-serif text-2xl text-fg">What's packed</h2>
      <ul className="space-y-4 border-l border-border/30 pl-6">
        {ingredients.map((item) => (
          <li key={item} className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-warm" aria-hidden />
            <span className="text-fg-muted">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

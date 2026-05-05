interface MomentHeadlineProps {
  text: string;
}

// Empty text → visually hidden h1 preserves the ARIA landmark while the
// projection is still seeded with empty strings (Story 3.6 stub). Rendering
// a non-empty placeholder would be misleading; rendering nothing would drop
// the landmark.
export function MomentHeadline({ text }: MomentHeadlineProps) {
  if (text === '') return <h1 className="sr-only">Weekly plan</h1>;
  return (
    <h1 className="font-serif text-[22px] md:text-[26px] leading-[1.3] font-normal text-stone-900">
      {text}
    </h1>
  );
}

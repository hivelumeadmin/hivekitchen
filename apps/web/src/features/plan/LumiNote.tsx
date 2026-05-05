interface LumiNoteProps {
  text: string;
}

// Empty text → renders nothing. The Story 3.6 projection stub emits empty
// strings; a future story populates lumi_note with real LLM-generated copy.
// border-l-lumi-terracotta-500 maps to var(--lumi-terracotta-500) (#b46a4e)
// via the design-system token preset — Lumi→child channel color (UX-DR1, DR17).
export function LumiNote({ text }: LumiNoteProps) {
  if (text === '') return null;
  return (
    <p className="font-sans text-[16px] md:text-[17px] leading-[1.5] ps-3 border-s-4 border-lumi-terracotta-500 text-stone-800">
      {text}
    </p>
  );
}

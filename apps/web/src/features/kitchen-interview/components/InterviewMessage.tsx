import type { MessagePart } from '../data/mockData.js';

interface Readonly_InterviewMessageProps {
  readonly parts: readonly MessagePart[];
  /** Use the larger serif style (Lumi turns) vs sans-serif body (user turns). */
  readonly variant: 'serif' | 'sans';
}

export type InterviewMessageProps = Readonly<Readonly_InterviewMessageProps>;

export function InterviewMessage({ parts, variant }: InterviewMessageProps) {
  const baseClass =
    variant === 'serif'
      ? 'font-serif text-2xl leading-relaxed text-fg'
      : 'text-[15px] leading-relaxed text-fg';
  return (
    <p className={baseClass}>
      {parts.map((part, i) =>
        part.highlight ? (
          <span key={i} className="text-sacred">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

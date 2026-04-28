import Markdown from 'react-markdown';
import type { ParentalNoticeResponse, ProcessorEntry } from '@hivekitchen/types';

// h1/h2 from the notice document map to h3/h4 — the dialog title is already
// an h2 and the account-page section heading is h2/h3, so rendering h1 here
// would break heading hierarchy for screen readers.
const MARKDOWN_COMPONENTS = {
  h1: (props: React.ComponentProps<'h1'>) => (
    <h3 className="font-serif text-xl text-stone-800 mt-2 mb-3" {...props} />
  ),
  h2: (props: React.ComponentProps<'h2'>) => (
    <h4 className="font-serif text-base text-stone-800 mt-4 mb-2" {...props} />
  ),
  p: (props: React.ComponentProps<'p'>) => <p className="my-2" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => (
    <ul className="list-disc pl-5 my-2 space-y-1" {...props} />
  ),
  li: (props: React.ComponentProps<'li'>) => <li className="my-1" {...props} />,
  strong: (props: React.ComponentProps<'strong'>) => (
    <strong className="font-medium text-stone-800" {...props} />
  ),
  a: (props: React.ComponentProps<'a'>) => (
    <a
      className="underline text-stone-800 hover:text-stone-900"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
};

interface Props {
  notice: ParentalNoticeResponse;
}

export function ParentalNoticeContent({ notice }: Props) {
  return (
    <>
      <div className="font-sans text-sm text-stone-700 leading-relaxed">
        <Markdown components={MARKDOWN_COMPONENTS}>{notice.content}</Markdown>
      </div>

      <h3 className="font-serif text-base text-stone-800 mt-6 mb-3">Processors at a glance</h3>
      <ul className="flex flex-col gap-3">
        {notice.processors.map((p: ProcessorEntry) => (
          <li
            key={p.name}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3"
          >
            <p className="font-serif text-sm text-stone-800">{p.display_name}</p>
            <p className="font-sans text-xs text-stone-600 mt-1">{p.purpose}</p>
            <p className="font-sans text-xs text-stone-500 mt-2">
              <span className="font-medium text-stone-700">Retention:</span> {p.retention_label}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

import type { MemoryNode } from '@hivekitchen/types';
import { ProvenancePopover } from './ProvenancePopover.js';

interface Props {
  node: MemoryNode;
}

// Story 7-S1 — one memory row on the Visible Memory page.
// Story 7-S2 — `⋯` affordance replaced with <ProvenancePopover> which owns
// the button trigger + provenance panel. Layout contract unchanged.
export function VisibleMemorySentence({ node }: Props) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
      <p className="font-sans text-base text-fg leading-relaxed">{node.prose_text}</p>
      <ProvenancePopover nodeId={node.id} />
    </div>
  );
}

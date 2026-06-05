import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EditMemoryResponseSchema, ForgetMemoryResponseSchema } from '@hivekitchen/contracts';
import type { MemoryNode } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { ProvenancePopover } from './ProvenancePopover.js';
import { TextField } from './TextField.js';

interface Props {
  node: MemoryNode;
  onNodeUpdated: (node: MemoryNode) => void;
  showHelper?: boolean;
}

const SAVE_ERROR_COPY = "Couldn't save your edit. Try again.";
const FORGET_ERROR_COPY = "Couldn't forget this memory. Try again.";

// Story 7-S1 — one memory row on the Visible Memory page.
// Story 7-S2 — `⋯` affordance is <ProvenancePopover>.
// Story 7-S3 — tapping Edit flips the row to an inline editor that PATCHes the
// prose and lifts the saved node up via onNodeUpdated (API stays source of truth).
// Story 7-S4 — tapping Forget flips the row to an inline confirmation; once
// confirmed the row renders a tombstone (no `⋯`, no controls).
export function VisibleMemorySentence({ node, onNodeUpdated, showHelper }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(node.prose_text);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConfirmingForget, setIsConfirmingForget] = useState(false);
  const [forgetReason, setForgetReason] = useState('');
  const [isForgetting, setIsForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // AC1 — focus the editor on entering edit mode (DOM sync, not derived state).
  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  function cancelEdit() {
    setIsEditing(false);
    setSaveError(null);
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  const trimmed = draft.trim();
  const saveDisabled = trimmed.length === 0 || trimmed === node.prose_text || isSaving;

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const raw = await hkFetch<unknown>(`/v1/memory/${node.id}`, {
        method: 'PATCH',
        body: { prose_text: trimmed, reason: 'parent_edit' },
      });
      const { node: updated } = EditMemoryResponseSchema.parse(raw);
      onNodeUpdated(updated);
      setIsSaving(false);
      setIsEditing(false);
    } catch {
      setSaveError(SAVE_ERROR_COPY);
      setIsSaving(false);
    }
  }

  function cancelForget() {
    setIsConfirmingForget(false);
    setForgetError(null);
  }

  async function handleForget() {
    setIsForgetting(true);
    setForgetError(null);
    try {
      const body: { reason?: string } = {};
      const trimmedReason = forgetReason.trim();
      if (trimmedReason.length > 0) body.reason = trimmedReason;
      const raw = await hkFetch<unknown>(`/v1/memory/${node.id}/forget`, {
        method: 'PATCH',
        body,
      });
      const { node: updated } = ForgetMemoryResponseSchema.parse(raw);
      onNodeUpdated(updated);
      setIsForgetting(false);
      setIsConfirmingForget(false);
    } catch {
      setForgetError(FORGET_ERROR_COPY);
      setIsForgetting(false);
    }
  }

  // Story 7-S4 — tombstone view. Checked FIRST so a forgotten node never shows
  // the `⋯` button or any interactive control.
  if (node.soft_forget_at !== null) {
    return (
      <div className="flex items-start py-3 border-b border-border last:border-0">
        <p className="font-sans text-base text-fg-muted italic">
          {node.forget_reason
            ? `Lumi won't use this anymore — ${node.forget_reason}`
            : "Lumi won't use this anymore"}
        </p>
      </div>
    );
  }

  if (isConfirmingForget) {
    return (
      <div
        aria-busy={isForgetting}
        className="flex flex-col gap-2 py-3 border-b border-border last:border-0"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelForget();
          }
        }}
      >
        <p className="font-sans text-sm text-fg-muted">
          Lumi will stop using this. You can undo this for 30 days.
        </p>
        <TextField
          id={`forget-reason-${node.id}`}
          label="Reason (optional)"
          placeholder="Why are you forgetting this? (optional)"
          value={forgetReason}
          onChange={(e) => setForgetReason(e.target.value)}
          maxLength={500}
        />
        {forgetError && (
          <p role="alert" className="font-sans text-sm text-fg-muted">
            {forgetError}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleForget}
            disabled={isForgetting}
            className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm forget
          </button>
          <button
            type="button"
            onClick={cancelForget}
            className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div
        aria-busy={isSaving}
        className="flex flex-col gap-2 py-3 border-b border-border last:border-0"
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Edit memory"
          rows={2}
          maxLength={2000}
          className="w-full rounded-lg border border-border bg-surface p-2 font-sans text-base text-fg focus:outline-none focus:ring-2 focus:ring-foliage"
        />
        {saveError && (
          <p role="alert" className="font-sans text-sm text-fg-muted">
            {saveError}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            className="px-3 py-1 rounded-full font-sans text-xs text-fg border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="px-3 py-1 rounded-full font-sans text-xs text-fg-muted border border-border hover:bg-surface focus:outline-none focus:ring-2 focus:ring-foliage"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
      <p className="font-sans text-base text-fg leading-relaxed">{node.prose_text}</p>
      <ProvenancePopover
        nodeId={node.id}
        showHelper={showHelper}
        onEdit={() => {
          setDraft(node.prose_text);
          setSaveError(null);
          setIsEditing(true);
        }}
        onForget={() => {
          setIsConfirmingForget(true);
          setForgetReason('');
          setForgetError(null);
        }}
      />
    </div>
  );
}

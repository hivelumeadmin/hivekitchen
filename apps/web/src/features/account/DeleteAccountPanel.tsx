import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { Dialog } from '@/components/Dialog.js';
import { useHouseholdNameQuery } from './queries.js';
import { useDeleteAccountMutation } from './mutations.js';

const LOGOUT_DELAY_MS = 2000;

interface DeleteAccountPanelProps {
  householdId: string | null;
}

// Slice 7-S11 — account deletion. The confirmation dialog requires the parent
// to type the household display_name, fetched lazily from the kitchen-map
// projection the first time the dialog opens (the user profile carries the
// caregiver's name, not the household label).
export function DeleteAccountPanel({ householdId }: DeleteAccountPanelProps) {
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteSucceeded, setDeleteSucceeded] = useState(false);

  const householdName = useHouseholdNameQuery(householdId, showDeleteDialog);
  // Logout + redirect live in the mutation's own options, NOT in a
  // mutate()-scoped callback: React Query skips mutate-scoped callbacks when
  // the observer has no listeners, so an unmount mid-flight would delete the
  // household server-side and leave this client holding a live session.
  const deleteAccount = useDeleteAccountMutation(householdId, {
    onSuccess: async () => {
      setDeleteSucceeded(true);
      await new Promise((resolve) => setTimeout(resolve, LOGOUT_DELAY_MS));
      await useAuthStore.getState().logout();
      navigate('/auth/login', { replace: true });
    },
    onError: (err) => {
      if (err instanceof HkApiError && err.status === 401) {
        navigate('/auth/login?next=/account', { replace: true });
      }
    },
  });

  const householdDisplayName = householdName.data ?? null;
  const isPending = deleteAccount.isPending;
  const showError =
    deleteAccount.isError &&
    !(deleteAccount.error instanceof HkApiError && deleteAccount.error.status === 401);

  function closeDialog() {
    setShowDeleteDialog(false);
    setDeleteConfirmInput('');
    deleteAccount.reset();
  }

  function handleDeleteAccount() {
    if (householdId === null || householdDisplayName === null) return;
    deleteAccount.mutate({ confirmation_name: deleteConfirmInput });
  }

  return (
    <>
      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-serif text-xl text-fg">Delete account</h2>
        <p className="text-sm text-fg-muted">
          Permanently delete your household and all associated data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => {
            setShowDeleteDialog(true);
            setDeleteConfirmInput('');
            deleteAccount.reset();
          }}
          className="rounded border border-border px-4 py-2 text-sm"
        >
          Delete my account
        </button>
      </section>

      <Dialog
        open={showDeleteDialog}
        onClose={() => {
          if (isPending || deleteSucceeded) return;
          closeDialog();
        }}
        titleId="delete-account-dialog-title"
        descriptionId="delete-account-dialog-desc"
      >
        <div className="flex flex-col gap-4">
          <h2 id="delete-account-dialog-title" className="font-serif text-xl text-fg">
            Delete your account permanently?
          </h2>
          <p id="delete-account-dialog-desc" className="text-sm text-fg-muted">
            All household data — plans, children, memory, Heart Notes — will be erased within 30
            days. You will be logged out immediately and cannot log back in.
          </p>

          {householdName.isFetching && householdDisplayName === null ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : householdDisplayName !== null ? (
            <div className="space-y-1">
              <label htmlFor="delete-confirm-input" className="block text-sm">
                {`Type "${householdDisplayName}" to confirm`}
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                disabled={isPending || deleteSucceeded}
                className="w-full rounded border border-border px-3 py-2 disabled:opacity-50"
                placeholder={householdDisplayName}
                autoComplete="off"
              />
            </div>
          ) : householdName.isError ? (
            <p className="text-sm text-fg-muted">
              Could not load your household name. Please close and try again.
            </p>
          ) : null}

          {showError && (
            <p role="alert" className="text-sm text-safety-red">
              Something went wrong. Please try again.
            </p>
          )}

          {deleteSucceeded ? (
            <p className="text-sm text-fg-muted">Account deletion scheduled. Logging you out…</p>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isPending}
                className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={
                  isPending ||
                  householdDisplayName === null ||
                  deleteConfirmInput.trim().toLowerCase() !==
                    householdDisplayName.trim().toLowerCase()
                }
                className="rounded border border-border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

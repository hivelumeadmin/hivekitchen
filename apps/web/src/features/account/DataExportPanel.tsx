import { useNavigate } from 'react-router-dom';
import { HkApiError } from '@/lib/fetch.js';
import { useExportMutation } from './mutations.js';

interface DataExportPanelProps {
  householdId: string | null;
}

// Slice 7-S10 — request a full data-portability export. The POST returns 202
// (the snapshot is composed asynchronously and emailed as a signed link); the
// success copy replaces the button. No polling, no redirect.
export function DataExportPanel({ householdId }: DataExportPanelProps) {
  const navigate = useNavigate();
  const exportData = useExportMutation(householdId);

  function handleExport() {
    exportData.mutate(undefined, {
      onError: (err) => {
        if (err instanceof HkApiError && err.status === 401) {
          navigate('/auth/login?next=/account', { replace: true });
        }
      },
    });
  }

  // A 401 redirects instead of surfacing an error line.
  const showError =
    exportData.isError &&
    !(exportData.error instanceof HkApiError && exportData.error.status === 401);

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-serif text-xl text-fg">Data portability</h2>
      <p className="text-sm text-fg-muted">
        Download a copy of everything HiveKitchen has stored for your household.
        Encrypted fields are decrypted to plain text in the export.
      </p>
      {exportData.isSuccess ? (
        <p className="text-sm text-fg-muted">
          We&apos;re preparing your export. You&apos;ll receive an email with a download link within 72 hours.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportData.isPending}
            className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {exportData.isPending ? 'Exporting…' : 'Export my data'}
          </button>
          {showError && (
            <p role="alert" className="text-sm text-safety-red">
              Something went wrong. Please try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}

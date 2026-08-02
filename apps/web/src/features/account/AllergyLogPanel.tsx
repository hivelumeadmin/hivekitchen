import { useState } from 'react';
import { useAllergyLogDownloadMutation } from './mutations.js';

// Slice 4-S17 — download the household's allergy transparency log.
export function AllergyLogPanel() {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = useAllergyLogDownloadMutation();
  const downloading = download.isPending ? download.variables : null;

  function handleDownload(format: 'json' | 'pdf') {
    setDownloadError(null);
    download.mutate(format, {
      onError: () => setDownloadError('Could not download your allergy log. Please try again later.'),
    });
  }

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-serif text-xl text-fg">Allergy safety log</h2>
      <p className="text-sm text-fg-muted">
        Download a record of every allergy safety decision Lumi has made for your household.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleDownload('json')}
          disabled={download.isPending}
          className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          {downloading === 'json' ? 'Preparing…' : 'Download JSON'}
        </button>
        <button
          type="button"
          onClick={() => handleDownload('pdf')}
          disabled={download.isPending}
          className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>
      {downloadError && (
        <p role="alert" className="text-sm text-safety-red">{downloadError}</p>
      )}
    </section>
  );
}

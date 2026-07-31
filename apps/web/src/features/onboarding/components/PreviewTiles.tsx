import { WaveformIcon } from '@hivekitchen/ui';
import type { OnboardingPreviewTile } from '../data/mockData.js';

interface Readonly_PreviewTilesProps {
  readonly tiles: readonly OnboardingPreviewTile[];
}

export type PreviewTilesProps = Readonly<Readonly_PreviewTilesProps>;

export function PreviewTiles({ tiles }: PreviewTilesProps) {
  return (
    <section className="px-8 pb-24">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-16 md:grid-cols-3">
        {tiles.map((tile, i) => (
          <PreviewTile key={i} tile={tile} />
        ))}
      </div>
    </section>
  );
}

function PreviewTile({ tile }: Readonly<{ readonly tile: OnboardingPreviewTile }>) {
  return (
    <div className="flex flex-col items-center space-y-4 text-center">
      <div className="h-16 w-16 overflow-hidden rounded-full border border-border">
        {tile.imageSrc ? (
          <img
            src={tile.imageSrc}
            alt={tile.alt ?? tile.label}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface">
            <WaveformIcon className="h-6 w-6 text-amber-warm" />
          </div>
        )}
      </div>
      <p className="font-serif text-lg italic text-fg-muted">{tile.label}</p>
    </div>
  );
}

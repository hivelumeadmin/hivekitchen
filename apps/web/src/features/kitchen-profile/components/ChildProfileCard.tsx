import {
  AlertTriangleIcon,
  InfoIcon,
} from '../../../components/icons.js';
import type { Allergy, ChildProfile } from '../data/mockData.js';

interface Readonly_ChildProfileCardProps {
  readonly child: ChildProfile;
  readonly onEdit?: () => void;
}

export type ChildProfileCardProps = Readonly<Readonly_ChildProfileCardProps>;

export function ChildProfileCard({ child, onEdit }: ChildProfileCardProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/20 bg-surface p-8">
      <div className="absolute bottom-0 left-0 top-0 w-1 bg-amber-warm/20" />
      <div className="flex flex-col gap-8 md:flex-row">
        <ChildAvatar initial={child.initial} />
        <div className="flex-1 min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-3xl text-fg">
                {child.name}, {child.age}
              </h3>
              <span className="mt-2 inline-block rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-safety-cleared">
                {child.schoolBadge}
              </span>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="flex-shrink-0 text-sm font-medium text-amber-warm hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="mb-4 flex flex-wrap gap-x-4 text-[11px] font-bold uppercase tracking-wider text-fg-muted/60">
            {child.meta.map((label, i) => (
              <span key={i} className="flex items-center gap-4">
                {i > 0 ? <span aria-hidden>•</span> : null}
                <span>{label}</span>
              </span>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
            <AllergiesColumn allergies={child.allergies} />
            <LumiLearningColumn
              loves={child.loves}
              avoids={child.avoids}
              quote={child.lumiQuote}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildAvatar({ initial }: Readonly<{ readonly initial: string }>) {
  return (
    <div className="flex-shrink-0">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-border/20 bg-surface-2">
        <span className="font-serif text-4xl font-medium text-amber-warm">{initial}</span>
      </div>
    </div>
  );
}

function AllergiesColumn({ allergies }: Readonly<{ readonly allergies: readonly Allergy[] }>) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-safety-red">Allergies</p>
      <div className="space-y-2">
        {allergies.map((a) => (
          <AllergyRow key={a.name} allergy={a} />
        ))}
      </div>
    </div>
  );
}

function AllergyRow({ allergy }: Readonly<{ readonly allergy: Allergy }>) {
  if (allergy.severity === 'life-threatening') {
    return (
      <div className="flex items-center gap-2 text-safety-red">
        <AlertTriangleIcon className="h-[18px] w-[18px] flex-shrink-0" />
        <span className="text-[15px] font-medium">
          {allergy.name} — life-threatening
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-fg-muted">
      <InfoIcon className="h-[18px] w-[18px] flex-shrink-0" />
      <span className="text-[15px] font-medium">{allergy.name} — caution</span>
    </div>
  );
}

function LumiLearningColumn({
  loves,
  avoids,
  quote,
}: Readonly<{
  readonly loves: string;
  readonly avoids: string;
  readonly quote?: string;
}>) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-warm">
        Lumi Learning
      </p>
      <div className="space-y-3 text-fg-muted">
        <p className="text-sm">
          <span className="text-fg">Loves:</span> {loves}
        </p>
        <p className="text-sm">
          <span className="text-fg">Avoids:</span> {avoids}
        </p>
        {quote ? (
          <div className="mt-2 rounded-lg border border-amber-warm/20 bg-amber-warm/10 p-3">
            <p className="text-xs italic text-lumi-terracotta">{quote}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

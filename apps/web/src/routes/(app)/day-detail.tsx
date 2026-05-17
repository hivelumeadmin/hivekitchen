import { useParams } from 'react-router-dom';
import { DetailHeader } from '@/components/DetailHeader.js';
import { PageHeader } from '@/components/PageHeader.js';
import { AllergenScanCard } from '@/features/day-detail/components/AllergenScanCard.js';
import { BottomActionBar } from '@/features/day-detail/components/BottomActionBar.js';
import { IngredientList } from '@/features/day-detail/components/IngredientList.js';
import { LunchImage } from '@/features/day-detail/components/LunchImage.js';
import { MorningNotesCard } from '@/features/day-detail/components/MorningNotesCard.js';
import { SafetyCard } from '@/features/day-detail/components/SafetyCard.js';
import { SourceCard } from '@/features/day-detail/components/SourceCard.js';
import { WhyLumiChoseCard } from '@/features/day-detail/components/WhyLumiChoseCard.js';
import { dayDetailMock } from '@/features/day-detail/data/mockData.js';

export default function DayDetailRoute() {
  const { day } = useParams<{ day: string }>();
  const d = dayDetailMock;
  const currentLabel = day !== undefined && day !== '' ? day : 'Tuesday 12 May';

  return (
    <>
      <DetailHeader contextLabel="This week" currentLabel={currentLabel} />
      <main className="mx-auto w-full max-w-7xl flex-grow px-8 pb-32 pt-12">
        <PageHeader
          eyebrow={d.eyebrow}
          eyebrowTone="sacred"
          headlineSize="md"
          headlineItalic
          description={d.description}
        >
          {d.headline}
        </PageHeader>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-10">
          <div className="space-y-12 lg:col-span-6">
            <LunchImage servingNote={d.servingNote} />
            <IngredientList ingredients={d.ingredients} />
            <MorningNotesCard note={d.morningNotes} />
          </div>
          <div className="space-y-4 lg:col-span-4">
            <SafetyCard safety={d.safety} />
            <AllergenScanCard allergens={d.allergens} />
            <WhyLumiChoseCard reasons={d.whyLumiChose} />
            <SourceCard source={d.source} />
          </div>
        </div>
      </main>
      <BottomActionBar footerHint={d.footerHint} />
    </>
  );
}

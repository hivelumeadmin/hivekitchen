import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { PageHeader } from '../components/PageHeader.js';
import { ActionRow } from '../features/weekly-plan/components/ActionRow.js';
import { PlanGrid } from '../features/weekly-plan/components/PlanGrid.js';
import { WhyThisWeekPanel } from '../features/weekly-plan/components/WhyThisWeekPanel.js';
import {
  weeklyPlanBriefMock,
  weeklyPlanMock,
  whyThisWeekMock,
} from '../features/weekly-plan/data/mockData.js';

export function DevWeeklyPlanPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-grow px-8 pb-32 pt-16">
        <PageHeader
          eyebrow={weeklyPlanBriefMock.eyebrow}
          headlineSize="lg"
          description={weeklyPlanBriefMock.lumiNote}
          className="mb-16"
        >
          {weeklyPlanBriefMock.headline}
        </PageHeader>

        <div className="mb-16">
          <PlanGrid tiles={weeklyPlanMock} />
        </div>

        <WhyThisWeekPanel reasons={whyThisWeekMock} />

        <ActionRow />
      </main>
      <AppFooter />
    </div>
  );
}

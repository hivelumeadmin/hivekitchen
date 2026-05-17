import { useParams, useSearchParams } from 'react-router-dom';
import { SchoolPoliciesForm } from '@/features/children/SchoolPoliciesForm.js';

export default function ChildSchoolPoliciesPage() {
  const { childId = '' } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const childName = searchParams.get('name') ?? 'your child';

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <SchoolPoliciesForm childId={childId} childName={childName} />
    </main>
  );
}

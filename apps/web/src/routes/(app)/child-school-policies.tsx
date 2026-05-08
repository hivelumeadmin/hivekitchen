import { useParams, useSearchParams } from 'react-router-dom';
import { SchoolPoliciesForm } from '@/features/children/SchoolPoliciesForm.js';

export default function ChildSchoolPoliciesPage() {
  const { childId = '' } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const childName = searchParams.get('name') ?? 'your child';

  return (
    <div className="py-8 px-4">
      <SchoolPoliciesForm childId={childId} childName={childName} />
    </div>
  );
}

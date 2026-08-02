import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { useMeQuery } from '@/features/account/queries.js';
import { ProfilePanel } from '@/features/account/ProfilePanel.js';
import { PasswordPanel } from '@/features/account/PasswordPanel.js';
import { NotificationsPanel } from '@/features/account/NotificationsPanel.js';
import { AccessibilityPanel } from '@/features/account/AccessibilityPanel.js';
import { VoiceDataPanel } from '@/features/account/VoiceDataPanel.js';
import { FamilyLanguagePanel } from '@/features/account/FamilyLanguagePanel.js';
import { PrivacyPanel } from '@/features/account/PrivacyPanel.js';
import { AllergyLogPanel } from '@/features/account/AllergyLogPanel.js';
import { DataExportPanel } from '@/features/account/DataExportPanel.js';
import { DeleteAccountPanel } from '@/features/account/DeleteAccountPanel.js';

export default function AccountPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);

  const me = useMeQuery(accessToken !== null ? userId : null);

  useEffect(() => {
    if (accessToken === null) {
      navigate('/auth/login?next=/account', { replace: true });
    }
  }, [accessToken, navigate]);

  if (me.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p className="font-serif text-lg text-fg-muted">Loading your profile…</p>
      </main>
    );
  }

  const profile = me.data;
  if (me.isError || profile === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-grow items-center justify-center px-6 py-24">
        <p role="alert" className="font-serif text-lg text-fg-muted">
          We couldn&apos;t load your account. Please try again later.
        </p>
      </main>
    );
  }

  const canReadAllergyLog =
    profile.role === 'primary_parent' || profile.role === 'secondary_caregiver';
  const isPrimaryParent = profile.role === 'primary_parent';

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <PageHeader
        eyebrow="Settings"
        headlineSize="md"
        description="Update your details. Changes apply only to your profile."
        className="mb-12"
      >
        Your account
      </PageHeader>
      <div className="mx-auto w-full max-w-md space-y-8">
        <ProfilePanel profile={profile} />
        <PasswordPanel profile={profile} />
        <NotificationsPanel profile={profile} />
        <AccessibilityPanel profile={profile} />
        <VoiceDataPanel profile={profile} userId={userId} />
        <FamilyLanguagePanel profile={profile} />
        <PrivacyPanel profile={profile} />
        {canReadAllergyLog && <AllergyLogPanel />}
        {isPrimaryParent && <DataExportPanel householdId={householdId} />}
        {isPrimaryParent && <DeleteAccountPanel householdId={householdId} />}
      </div>
    </main>
  );
}

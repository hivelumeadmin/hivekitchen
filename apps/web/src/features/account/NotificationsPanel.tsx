import { useState } from 'react';
import type { NotificationPrefs, UserProfile } from '@hivekitchen/types';
import { useNotificationPrefsMutation } from './mutations.js';

interface NotificationsPanelProps {
  profile: UserProfile;
}

export function NotificationsPanel({ profile }: NotificationsPanelProps) {
  const [notifError, setNotifError] = useState<string | null>(null);
  const notificationPrefs = useNotificationPrefsMutation();
  const prefs = profile.notification_prefs;

  function handleToggle(field: keyof NotificationPrefs, checked: boolean) {
    setNotifError(null);
    notificationPrefs.mutate(
      { field, checked },
      {
        onError: () =>
          setNotifError('Could not update notification preference. Please try again.'),
      },
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-serif text-xl text-fg">Notifications</h2>
      <p className="text-sm text-fg-muted">
        Choose when Lumi reaches out. Toggle anytime.
      </p>
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm">Weekly plan is ready</span>
        <input
          type="checkbox"
          checked={prefs.weekly_plan_ready}
          onChange={(e) => handleToggle('weekly_plan_ready', e.target.checked)}
          disabled={notificationPrefs.isPending}
          className="h-4 w-4"
        />
      </label>
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm">Grocery list is ready</span>
        <input
          type="checkbox"
          checked={prefs.grocery_list_ready}
          onChange={(e) => handleToggle('grocery_list_ready', e.target.checked)}
          disabled={notificationPrefs.isPending}
          className="h-4 w-4"
        />
      </label>
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm">Lumi proactive nudges</span>
        <input
          type="checkbox"
          checked={prefs.proactive_lumi_nudges}
          onChange={(e) => handleToggle('proactive_lumi_nudges', e.target.checked)}
          disabled={notificationPrefs.isPending}
          className="h-4 w-4"
        />
      </label>
      {notifError && (
        <p role="alert" className="text-sm text-safety-red">{notifError}</p>
      )}
    </section>
  );
}

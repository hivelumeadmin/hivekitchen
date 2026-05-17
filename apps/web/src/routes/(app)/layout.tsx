import { Outlet, useMatch } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { AppFooter } from '@/components/AppFooter.js';
import { AppHeader } from '@/components/AppHeader.js';
import { LumiOrb } from '@/components/LumiOrb.js';
import { LumiPanel } from '@/components/LumiPanel.js';

export default function AppScopeLayout() {
  useScope('app-scope');
  const onLunchRoute = useMatch('/lunch/*');
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <div className="flex-grow">
        <Outlet />
      </div>
      <AppFooter />
      {!onLunchRoute && <LumiOrb />}
      {!onLunchRoute && <LumiPanel />}
    </div>
  );
}

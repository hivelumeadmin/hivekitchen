import { Outlet, useMatch } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import { LumiOrb } from '@/components/LumiOrb.js';
import { LumiPanel } from '@/components/LumiPanel.js';

export default function AppScopeLayout() {
  useScope('app-scope');
  const onLunchRoute = useMatch('/lunch/*');
  return (
    <>
      <Outlet />
      {!onLunchRoute && <LumiOrb />}
      {!onLunchRoute && <LumiPanel />}
    </>
  );
}

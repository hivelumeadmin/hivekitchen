import type { ReactNode } from 'react';
import { useScope } from '@hivekitchen/ui';

interface LayoutProps {
  children: ReactNode;
}

export default function AppScopeLayout({ children }: LayoutProps) {
  useScope('app-scope');
  return <>{children}</>;
}

import type { ReactNode } from 'react';
import { useScope } from '@hivekitchen/ui';

interface LayoutProps {
  children: ReactNode;
}

export default function OpsScopeLayout({ children }: LayoutProps) {
  useScope('ops-scope');
  return <>{children}</>;
}

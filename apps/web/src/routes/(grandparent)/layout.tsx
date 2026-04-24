import type { ReactNode } from 'react';
import { useScope } from '@hivekitchen/ui';

interface LayoutProps {
  children: ReactNode;
}

export default function GrandparentScopeLayout({ children }: LayoutProps) {
  useScope('grandparent-scope');
  return <>{children}</>;
}

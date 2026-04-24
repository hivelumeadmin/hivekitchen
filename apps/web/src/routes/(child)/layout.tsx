import type { ReactNode } from 'react';
import { useScope } from '@hivekitchen/ui';

interface LayoutProps {
  children: ReactNode;
}

export default function ChildScopeLayout({ children }: LayoutProps) {
  useScope('child-scope');
  return <>{children}</>;
}

// @file: apps/web/src/features/plan/some-modal.tsx
// Dialog primitive outside the allowlisted directories — lint must fail.
import * as Dialog from '@radix-ui/react-dialog';

export function PlanModal() {
  return <Dialog.Root />;
}

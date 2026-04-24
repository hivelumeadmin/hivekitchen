// @file: apps/web/src/routes/(child)/lunch-link.tsx
// Importing a forbidden component into .child-scope — lint must fail.
import { Command, AlertDialog } from '@hivekitchen/ui';

export function LunchLink() {
  return (
    <>
      <Command />
      <AlertDialog />
    </>
  );
}

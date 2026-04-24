// @file: apps/web/src/routes/(child)/lunch-link.tsx
// Importing allowed components into .child-scope — lint must pass.
import { HeartNote, FlavorPassport } from '@hivekitchen/ui';

export function LunchLink() {
  return (
    <section>
      <HeartNote />
      <FlavorPassport />
    </section>
  );
}

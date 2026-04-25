import { useScope } from '@hivekitchen/ui';

export default function AppHomePage() {
  useScope('app-scope');
  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="font-serif text-lg">Brief stub</p>
    </main>
  );
}

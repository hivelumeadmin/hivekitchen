import { AppFooter } from '../components/AppFooter.js';
import { AppHeader } from '../components/AppHeader.js';
import { LoginForm } from '../features/login/components/LoginForm.js';
import { LoginHero } from '../features/login/components/LoginHero.js';

export function DevLoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <AppHeader />
      <main className="flex flex-1 flex-col md:flex-row">
        <LoginHero />
        <LoginForm />
      </main>
      <AppFooter />
    </div>
  );
}

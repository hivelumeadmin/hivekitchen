// apps/web/src/app.tsx
import { QueryProvider } from './providers/query-provider.js';
import { DevTokensPage } from './routes/_dev-tokens.js';

export function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname === '/_dev-tokens') {
    return <DevTokensPage />;
  }
  return (
    <QueryProvider>
      <div>HiveKitchen</div>
    </QueryProvider>
  );
}

import { DevTokensPage } from './routes/_dev-tokens.js';

export function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname === '/_dev-tokens') {
    return <DevTokensPage />;
  }
  return <div>HiveKitchen</div>;
}

const footerLinks = [
  { href: '#', label: 'Privacy Policy' },
  { href: '#', label: 'Terms of Service' },
  { href: '#', label: 'Help Center' },
] as const;

export function AppFooter() {
  return (
    <footer className="mt-auto w-full border-t border-neutral-400/30 bg-bg">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-8 py-12 md:flex-row">
        <div className="font-serif text-2xl text-fg-muted">HiveKitchen</div>
        <nav className="flex gap-8">
          {footerLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-xs uppercase tracking-widest text-fg-muted opacity-70 transition-all duration-300 hover:text-amber-warm hover:opacity-100"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="text-xs uppercase tracking-widest text-fg-muted/60">
          © 2026 HiveLume LLC — Lumi AI school-lunch companion.
        </div>
      </div>
    </footer>
  );
}

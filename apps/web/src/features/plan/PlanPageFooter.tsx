export function PlanPageFooter() {
  return (
    <footer className="border-t border-border/10 bg-bg py-12 mt-auto -mx-8">
      <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-8">
        <p className="font-sans text-xs text-fg-muted/60">
          &copy; 2026 HIVELUME LLC
        </p>
        <nav aria-label="Footer links" className="flex items-center gap-6">
          <a
            href="/privacy"
            className="font-sans text-xs text-fg-muted/60 hover:text-fg-muted transition-colors"
          >
            Privacy Policy
          </a>
          <a
            href="/terms"
            className="font-sans text-xs text-fg-muted/60 hover:text-fg-muted transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="/help"
            className="font-sans text-xs text-fg-muted/60 hover:text-fg-muted transition-colors"
          >
            Help Center
          </a>
        </nav>
      </div>
    </footer>
  );
}

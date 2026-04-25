// @file: packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/valid.tsx
// jsx-a11y-compliant equivalents of invalid.tsx.

export function WithAlt() {
  return <img src="/logo.png" alt="HiveKitchen logo" />;
}

export function AnchorWithText() {
  return <a href="/home">Go home</a>;
}

export function FocusableButton() {
  return (
    <button type="button" onClick={() => {}}>
      Click me
    </button>
  );
}

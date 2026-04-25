// @file: packages/eslint-config-hivekitchen/__fixtures__/jsx-a11y/invalid.tsx
// jsx-a11y strict violations — lint must fail.

export function MissingAlt() {
  return <img src="/logo.png" />;
}

export function EmptyAnchor() {
  return <a href="/home"></a>;
}

export function NonFocusableButton() {
  return <div onClick={() => {}} />;
}

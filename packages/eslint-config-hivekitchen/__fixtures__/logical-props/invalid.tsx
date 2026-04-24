// Physical Tailwind classes and CSS-in-JS props — lint must fail.
export function Card() {
  return (
    <div
      className="ml-4 mr-2 pl-3 pr-1"
      style={{ marginLeft: 8, paddingRight: 12 }}
    />
  );
}

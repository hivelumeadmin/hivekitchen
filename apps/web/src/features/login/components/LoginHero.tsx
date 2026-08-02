import { loginImageMock } from '../data/mockData.js';

export function LoginHero() {
  return (
    <div className="relative h-[40vh] w-full flex-shrink-0 md:h-auto md:w-3/5">
      <img
        src={loginImageMock.src}
        alt={loginImageMock.alt}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-[color-mix(in_srgb,var(--bg)_80%,transparent)] to-transparent md:bg-gradient-to-r" />
    </div>
  );
}

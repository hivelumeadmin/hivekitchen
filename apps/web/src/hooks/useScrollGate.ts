import { useEffect, useState, type RefObject } from 'react';

const SCROLL_FLOOR_PX = 8;

// Three-tier scroll gate (extracted from Story 2.8 review patches):
//   1. If the content does not overflow (short doc, tall viewport), the gate
//      resolves immediately at mount.
//   2. IntersectionObserver scoped to the scroll container (NOT the browser
//      viewport) — fires when the bottom sentinel enters view.
//   3. Plain scroll listener fallback when IntersectionObserver is absent.
//
// `armed` lets the caller delay the gate until content is rendered (e.g.,
// once the markdown has loaded). When `armed === false` the gate stays
// false; the caller flips `armed` to true to start measuring.
export function useScrollGate(
  scrollRef: RefObject<HTMLElement | null>,
  sentinelRef: RefObject<HTMLElement | null>,
  armed: boolean,
): boolean {
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    if (!armed) {
      setHasScrolled(false);
      return;
    }
    const container = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (container === null || sentinel === null) return;

    if (container.scrollHeight <= container.clientHeight) {
      setHasScrolled(true);
      return;
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting === true) setHasScrolled(true);
        },
        { root: container, threshold: 1.0 },
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }

    const onScroll = () => {
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - SCROLL_FLOOR_PX
      ) {
        setHasScrolled(true);
      }
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [armed, scrollRef, sentinelRef]);

  return hasScrolled;
}

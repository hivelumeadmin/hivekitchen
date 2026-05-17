import { useState } from 'react';
import { onboardingMock } from '../data/mockData.js';
import { AudioPanel, TextPanel, VideoPanel } from './MediaPanels.js';
import { MediaTabs, type MediaMode } from './MediaTabs.js';

export function MediaSection() {
  const [mode, setMode] = useState<MediaMode>('video');
  const m = onboardingMock;
  return (
    <>
      <MediaTabs active={mode} onChange={setMode} />
      <section className="min-h-[400px] px-8 py-24">
        <div className="mx-auto max-w-[720px]">
          {mode === 'video' ? (
            <VideoPanel imageSrc={m.video.imageSrc} imageAlt={m.video.imageAlt} />
          ) : null}
          {mode === 'audio' ? (
            <AudioPanel
              caption={m.audio.caption}
              // Slice 2-S20: feed the same text the "Read Text" tab shows.
              // Lumi narrates exactly what's on the page; no separate copy
              // source-of-truth to drift.
              text={m.textOverview.join(' ')}
            />
          ) : null}
          {mode === 'text' ? <TextPanel paragraphs={m.textOverview} /> : null}
        </div>
      </section>
    </>
  );
}

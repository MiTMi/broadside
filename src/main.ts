import './styles/tokens.css';
import './styles/base.css';
import './styles/board.css';
import './styles/screens.css';

import { createApp } from './ui/app';
import { roomFromHref } from './net/index';
import { TABLE_BG } from './ui/assets';
import { createSound } from './ui/sound';
import { must } from './ui/dom';

// The table art reaches CSS as a custom property so that `ui/assets.ts` stays
// the one place that knows where the image files live.
document.documentElement.style.setProperty('--table-image', `url("${TABLE_BG}")`);

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const parsedSeed = seedParam === null ? Number.NaN : Number(seedParam);
const seed = Number.isFinite(parsedSeed) ? Math.trunc(parsedSeed) : Date.now() >>> 0;

createApp(must(document.querySelector<HTMLElement>('#app'), '#app'), {
  // Synthesized WebAudio; falls back to silence wherever WebAudio is not.
  sfx: createSound(),
  seed,
  fast: params.get('fast') === '1',
  // Two tabs of this browser (`?transport=local`, for tests and demos) or the
  // real peer-to-peer connection (Decision N2).
  transport: params.get('transport') === 'local' ? 'local' : 'peer',
  // `?room=ABC234`: someone shared a game — open straight into joining it (N8).
  room: roomFromHref(window.location.href),
});

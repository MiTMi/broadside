/**
 * The game's sound. The big moments — hit, miss, sunk, victory, defeat — are
 * recorded effects (`soundSamples.ts`), decoded once when the context starts.
 * The small interface cues (peg tick, select, place, start) are synthesized with
 * WebAudio, and every sampled cue keeps a synthesized fallback that plays if its
 * recording is missing or has not finished decoding, so the game is never mute.
 *
 * Every shot opens with the signature peg tick. Behind it: a splash for a miss,
 * a layered shell burst for a hit (crack, saturated body, boom, rumble,
 * debris), a bigger double blast plus the hull sliding under for a sinking.
 * Away from the board: a blip for a selection, a knock for a placed ship, two
 * notes to start the battle and a short stinger for the end.
 *
 * Loudness: cues are short, but they have to be *heard* on a laptop speaker,
 * which rolls off hard below ~300 Hz. So every low element carries an upper
 * partial in the 300 Hz – 3 kHz band where those speakers actually work. The
 * master is 0.7 into a limiter and then a soft ceiling, so however many cues
 * overlap the output cannot pass ~0.93 of full scale. `select` is clearly the
 * quietest, `sunk` the loudest. The measured peak and length of every cue is
 * asserted in `e2e/audio.spec.ts`.
 *
 * The AudioContext is created lazily on the first cue — which is always a click
 * or an Enter/Space press — because browsers refuse to start audio before a
 * user gesture. Nothing here may ever throw: if WebAudio is missing or refuses
 * to start, the whole thing degrades to silence and the game plays on.
 */
import type { Sfx, SfxEvent } from './sfx';
import { SAMPLES, loadSampleBytes } from './soundSamples';
import type { SampleName } from './soundSamples';

const STORAGE_KEY = 'broadside.muted';
const MASTER_GAIN = 0.7;
/** A hair of lookahead so the first ramp is never scheduled in the past. */
const LEAD = 0.005;
/** How long a context needs before its output is really flowing. */
const WARMUP = 0.14;

export function createSound(): Sfx {
  let muted = readMuted();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let unavailable = false;
  /** Decoded recordings, filled in asynchronously after the context starts. */
  const samples: Partial<Record<SampleName, AudioBuffer>> = {};
  /**
   * Context time before which nothing may be scheduled: a just-created (or
   * just-resumed) context reports a running clock a beat before its output
   * device is actually rendering, and anything scheduled into that gap is
   * simply lost — which is why the very first cue used to be a faint click.
   */
  let readyAt = 0;

  /** Creates the graph on first use, and resumes it after an autoplay block. */
  function ensure(): AudioContext | null {
    if (unavailable) return null;
    if (ctx) {
      if (ctx.state === 'suspended') {
        resume(ctx);
        readyAt = ctx.currentTime + WARMUP;
      }
      return ctx;
    }
    try {
      const Ctor = audioContextCtor();
      if (!Ctor) {
        unavailable = true;
        return null;
      }
      const created = new Ctor();
      const gain = created.createGain();
      gain.gain.value = MASTER_GAIN;
      // A gentle limiter, not an effect: everything below the threshold passes
      // through untouched, so the cues keep their relative loudness, and only
      // overlapping cues get pulled back under full scale.
      const limiter = created.createDynamicsCompressor();
      limiter.threshold.value = -5;
      limiter.knee.value = 3;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      // …and behind it a soft ceiling that is exactly transparent below 0.7 and
      // mathematically cannot output past ~0.93, whatever stacks up.
      const ceiling = created.createWaveShaper();
      ceiling.curve = curve(ceilingShape);
      gain.connect(limiter).connect(ceiling).connect(created.destination);
      ctx = created;
      master = gain;
      noise = createNoiseBuffer(created);
      readyAt = created.currentTime + WARMUP;
      if (created.state === 'suspended') resume(created);
      loadSamples(created, samples);
      return created;
    } catch {
      // No WebAudio (or it refused to construct): never try again, stay silent.
      unavailable = true;
      return null;
    }
  }

  return {
    play(event: SfxEvent): void {
      if (muted) return;
      try {
        const audio = ensure();
        if (!audio || !master || !noise) return;
        const at = Math.max(audio.currentTime + LEAD, readyAt);
        if (!playSample(audio, master, samples, event, at)) render(audio, master, noise, event, at);
      } catch {
        // A cue is never worth breaking a turn over.
        unavailable = true;
      }
    },

    isMuted: (): boolean => muted,

    setMuted: (next: boolean): void => {
      muted = next;
      writeMuted(next);
      // Unmuting is itself a gesture: warm the context up so the next cue is
      // instant rather than swallowed by a suspended graph.
      if (!next) ensure();
    },
  };
}

// --- recorded cues -------------------------------------------------------

/** When the end-of-game music starts: after the final blast, as the card appears. */
const RESULT_DELAY = 0.9;

function isSampleName(event: SfxEvent): event is SampleName {
  return event in SAMPLES;
}

/** Decodes every recording in the background; a failure just leaves the synthesized cue in place. */
function loadSamples(ctx: AudioContext, into: Partial<Record<SampleName, AudioBuffer>>): void {
  for (const name of Object.keys(SAMPLES) as SampleName[]) {
    void loadSampleBytes(SAMPLES[name].url)
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        into[name] = buffer;
      })
      .catch(() => undefined);
  }
}

/** Plays the recording for `event` if there is one and it is ready. */
function playSample(
  ctx: AudioContext,
  out: AudioNode,
  samples: Partial<Record<SampleName, AudioBuffer>>,
  event: SfxEvent,
  t: number,
): boolean {
  if (!isSampleName(event)) return false;
  const buffer = samples[event];
  if (!buffer) return false;

  const music = event === 'win' || event === 'lose';
  // Every shot still opens with the signature peg tick.
  if (!music) peg(ctx, out, t);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // A few percent of pitch variation keeps repeated shots from sounding cloned.
  if (!music) source.playbackRate.value = 0.96 + Math.random() * 0.08;
  const gain = ctx.createGain();
  gain.gain.value = SAMPLES[event].gain;
  source.connect(gain).connect(out);
  const at = music ? t + RESULT_DELAY : t + 0.012;
  source.start(at);
  source.stop(at + buffer.duration / source.playbackRate.value + 0.05);
  return true;
}

// --- the cues ------------------------------------------------------------

function render(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, event: SfxEvent, t: number): void {
  switch (event) {
    // The quietest cue by design — but long enough and high enough to hear.
    case 'select':
      tone(ctx, out, { type: 'triangle', from: 880, to: 880, at: t, duration: 0.09, gain: 0.16 });
      tone(ctx, out, { type: 'triangle', from: 1760, to: 1760, at: t, duration: 0.05, gain: 0.07 });
      break;

    case 'place':
      peg(ctx, out, t);
      // A plastic knock: the body is low, the audible part is the 3rd harmonic.
      tone(ctx, out, { type: 'sine', from: 260, to: 130, at: t + 0.005, duration: 0.11, gain: 0.26 });
      tone(ctx, out, { type: 'triangle', from: 780, to: 390, at: t + 0.005, duration: 0.07, gain: 0.16 });
      break;

    case 'start':
      // Two notes a fifth apart, an octave higher than a ship's horn so a
      // laptop speaker can carry them: the hulls leaving the dock.
      horn(ctx, out, 294, t, 0.18);
      horn(ctx, out, 440, t + 0.15, 0.34);
      break;

    case 'miss':
      peg(ctx, out, t);
      splash(ctx, out, noise, t + 0.015);
      break;

    case 'hit':
      peg(ctx, out, t);
      blast(ctx, out, noise, t + 0.012, HIT_BLAST);
      break;

    case 'sunk':
      peg(ctx, out, t);
      blast(ctx, out, noise, t + 0.012, SUNK_BLAST);
      // The hull going down: a slow slide, doubled an octave up so the fall is
      // audible on a small speaker, and a few bubbles behind it.
      tone(ctx, out, { type: 'triangle', from: 330, to: 110, at: t + 0.3, duration: 0.75, gain: 0.28, sustain: 0.02 });
      tone(ctx, out, { type: 'sine', from: 165, to: 55, at: t + 0.3, duration: 0.75, gain: 0.24, sustain: 0.02 });
      bubbles(ctx, out, t + 0.72, 2);
      break;

    // The winning shot plays its own 'sunk' cue in the same tick: let that one
    // land first, and still finish well before the result card appears.
    case 'win':
      stinger(ctx, out, [523, 659, 784, 1047], t + 0.45, 0.1);
      break;

    case 'lose':
      stinger(ctx, out, [523, 415, 311], t + 0.45, 0.16);
      break;
  }
}

/** The signature tick of a peg landing in its well. */
function peg(ctx: AudioContext, out: AudioNode, t: number): void {
  tone(ctx, out, { type: 'square', from: 2400, to: 1300, at: t, duration: 0.04, gain: 0.14 });
}

/**
 * A shell landing: five layers that arrive in the order a real blast does —
 * crack (the transient your ear reads as "explosion"), body (a wall of noise
 * whose top end collapses), boom (the pressure wave), rumble, then debris.
 * Body and boom go through a soft-clipper, which is what gives an explosion
 * its saturated, slightly torn character rather than a clean tone.
 */
interface Blast {
  /** Scales every layer together: `sunk` is simply a bigger hit. */
  level: number;
  /** Level of the saturated layers after the soft-clipper. */
  drive: number;
  bodyFrom: number;
  bodyTo: number;
  bodyDuration: number;
  boomFrom: number;
  boomTo: number;
  boomDuration: number;
  rumbleGain: number;
  rumbleDuration: number;
  /** Little randomised debris ticks after the blast. */
  crackles: number;
  /** A second, deeper thump this long after the first (0 = one blast). */
  echo: number;
}

const HIT_BLAST: Blast = {
  level: 1,
  drive: 0.43,
  bodyFrom: 4200,
  bodyTo: 150,
  bodyDuration: 0.62,
  boomFrom: 112,
  boomTo: 38,
  boomDuration: 0.42,
  rumbleGain: 0.2,
  rumbleDuration: 0.7,
  crackles: 3,
  echo: 0,
};

const SUNK_BLAST: Blast = {
  level: 1.25,
  drive: 0.6,
  bodyFrom: 3600,
  bodyTo: 110,
  bodyDuration: 0.9,
  boomFrom: 88,
  boomTo: 30,
  boomDuration: 0.6,
  rumbleGain: 0.26,
  rumbleDuration: 1.1,
  crackles: 0, // the bubbles take this role
  echo: 0.12,
};

function blast(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, at: number, shape: Blast): void {
  const grit = saturator(ctx, out, shape.drive);

  // The crack stays clean — soft-clipping would blunt the one sharp edge.
  noiseBurst(ctx, out, noise, {
    filter: 'highpass',
    from: 3400,
    to: 2200,
    q: 0.7,
    at,
    duration: 0.028,
    gain: 0.27 * shape.level,
  });

  noiseBurst(ctx, grit, noise, {
    filter: 'lowpass',
    from: vary(shape.bodyFrom),
    to: shape.bodyTo,
    q: 0.9,
    at,
    duration: vary(shape.bodyDuration),
    gain: 0.62 * shape.level,
    sustain: 0.03,
  });

  tone(ctx, grit, {
    type: 'sine',
    from: vary(shape.boomFrom),
    to: shape.boomTo,
    at,
    duration: vary(shape.boomDuration),
    gain: 0.5 * shape.level,
    sustain: 0.04,
  });
  // The partial that carries the blast on a laptop speaker.
  tone(ctx, grit, {
    type: 'triangle',
    from: vary(shape.boomFrom * 2.1),
    to: shape.boomTo * 2.4,
    at,
    duration: shape.boomDuration * 0.75,
    gain: 0.3 * shape.level,
    sustain: 0.03,
  });

  if (shape.echo > 0) {
    noiseBurst(ctx, grit, noise, {
      filter: 'lowpass',
      from: 1600,
      to: 110,
      q: 0.9,
      at: at + shape.echo,
      duration: vary(shape.bodyDuration * 0.8),
      gain: 0.45 * shape.level,
      sustain: 0.03,
    });
  }

  noiseBurst(ctx, out, noise, {
    filter: 'bandpass',
    from: 760,
    to: 300,
    q: 0.8,
    at: at + 0.05,
    duration: shape.rumbleDuration,
    gain: shape.rumbleGain,
    sustain: 0.05,
  });

  crackle(ctx, out, noise, at, shape.crackles, 0.11 * shape.level);
}

/** Debris: a handful of tiny ticks at random moments after the blast. */
function crackle(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, at: number, count: number, gain: number): void {
  if (count <= 0) return;
  // One shared filter for all of them — each tick only needs its own envelope.
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2400;
  filter.connect(out);

  for (let i = 0; i < count; i++) {
    const when = at + 0.15 + Math.random() * 0.5;
    const level = gain * (0.5 + Math.random() * 0.6);
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const envelopeGain = ctx.createGain();
    envelope(envelopeGain, when, 0.03, level, 0);
    source.connect(envelopeGain).connect(filter);
    source.start(when, Math.random() * 1.5);
    source.stop(when + 0.06);
  }
}

/** Water closing over the hull: two small rising blips. */
function bubbles(ctx: AudioContext, out: AudioNode, at: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const when = at + i * 0.13 + Math.random() * 0.05;
    const base = 380 + i * 90;
    tone(ctx, out, { type: 'sine', from: base, to: base * 2.2, at: when, duration: 0.09, gain: 0.11 });
  }
}

/** A miss: the splash, the spray behind it, and two droplets falling back. */
function splash(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, at: number): void {
  noiseBurst(ctx, out, noise, {
    filter: 'bandpass',
    from: 2400,
    to: 900,
    q: 1,
    at,
    duration: 0.26,
    gain: 0.68,
  });
  noiseBurst(ctx, out, noise, {
    filter: 'highpass',
    from: 4400,
    to: 3000,
    q: 0.7,
    at: at + 0.012,
    duration: 0.14,
    gain: 0.2,
  });
  for (let i = 0; i < 2; i++) {
    const when = at + 0.11 + i * 0.07 + Math.random() * 0.04;
    tone(ctx, out, {
      type: 'sine',
      from: 1100 - i * 240,
      to: 620 - i * 140,
      at: when,
      duration: 0.05,
      gain: 0.12,
    });
  }
}

/** One note of the start signal: a body plus its fifth, softly attacked. */
function horn(ctx: AudioContext, out: AudioNode, note: number, t: number, duration: number): void {
  tone(ctx, out, { type: 'triangle', from: note, to: note, at: t, duration, gain: 0.42 });
  tone(ctx, out, { type: 'sine', from: note * 1.5, to: note * 1.5, at: t, duration, gain: 0.16 });
}

/** Three or four notes, played once, then out of the way. */
function stinger(ctx: AudioContext, out: AudioNode, notes: readonly number[], t: number, step: number): void {
  notes.forEach((note, index) => {
    const last = index === notes.length - 1;
    tone(ctx, out, {
      type: 'triangle',
      from: note,
      to: note,
      at: t + index * step,
      duration: last ? 0.7 : step + 0.06,
      gain: 0.42,
    });
    // A quiet octave on top: sparkle for the win, weight for the loss.
    tone(ctx, out, {
      type: 'sine',
      from: note * 2,
      to: note * 2,
      at: t + index * step,
      duration: last ? 0.5 : step + 0.04,
      gain: 0.12,
    });
  });
}

// --- primitives ----------------------------------------------------------

interface ToneOptions {
  type: OscillatorType;
  from: number;
  /** Equal to `from` for a flat note, lower for a fall. */
  to: number;
  at: number;
  duration: number;
  gain: number;
  /** See `envelope`: a fraction here buys a long, quiet tail. */
  sustain?: number;
}

function tone(ctx: AudioContext, out: AudioNode, options: ToneOptions): void {
  const osc = ctx.createOscillator();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, options.at);
  if (options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(options.to, 20), options.at + options.duration);
  }
  const gain = ctx.createGain();
  envelope(gain, options.at, options.duration, options.gain, options.sustain ?? 0);
  osc.connect(gain).connect(out);
  osc.start(options.at);
  osc.stop(endOf(options));
}

interface NoiseOptions {
  filter: BiquadFilterType;
  from: number;
  to: number;
  q: number;
  at: number;
  duration: number;
  gain: number;
  sustain?: number;
}

function noiseBurst(ctx: AudioContext, out: AudioNode, buffer: AudioBuffer, options: NoiseOptions): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.Q.value = options.q;
  filter.frequency.setValueAtTime(options.from, options.at);
  if (options.to !== options.from) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(options.to, 20), options.at + options.duration);
  }
  const gain = ctx.createGain();
  envelope(gain, options.at, options.duration, options.gain, options.sustain ?? 0);
  source.connect(filter).connect(gain).connect(out);
  // A different slice of noise each time, so repeated misses don't sound looped.
  source.start(options.at, Math.random() * 0.3);
  source.stop(endOf(options));
}

/**
 * Fast attack, exponential decay — exponential because zero is not allowed.
 *
 * `sustain` is what separates a click from a blast. Decaying straight to
 * silence over `duration` is eight e-foldings: the sound is effectively gone a
 * third of the way in. With a sustain fraction the ramp lands on that fraction
 * of the peak at `duration` and only then fades out, which leaves the long
 * quiet tail an explosion needs (and a hit that is still audible at 400 ms).
 */
function envelope(gain: GainNode, at: number, duration: number, peak: number, sustain: number): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.008, duration / 3));
  if (sustain <= 0) {
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    return;
  }
  gain.gain.exponentialRampToValueAtTime(Math.max(peak * sustain, 0.0002), at + duration);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 1.2 + 0.05);
}

/** When a layer's source may stop: its envelope has to have finished first. */
function endOf(options: { at: number; duration: number; sustain?: number }): number {
  const sustain = options.sustain ?? 0;
  return sustain > 0
    ? options.at + options.duration * 1.2 + 0.08
    : options.at + options.duration + 0.02;
}

/** ±10%: repeated hits are never quite the same shot. */
function vary(value: number): number {
  return value * (0.9 + Math.random() * 0.2);
}

/**
 * Wave-shaper curves. They are plain data, so each one is computed once and
 * shared by every node and every context.
 */
const curves = new Map<(x: number) => number, Float32Array<ArrayBuffer>>();

function curve(shape: (x: number) => number): Float32Array<ArrayBuffer> {
  const cached = curves.get(shape);
  if (cached) return cached;
  const size = 1024;
  const built = new Float32Array(size);
  for (let i = 0; i < size; i++) built[i] = shape((i / (size - 1)) * 2 - 1);
  curves.set(shape, built);
  return built;
}

/** Saturation: what turns a clean sine and some noise into an explosion. */
function gritShape(x: number): number {
  return Math.tanh(x * 2.4) / Math.tanh(2.4);
}

/** Straight through below 0.7, then bent over — output can never pass ~0.93. */
function ceilingShape(x: number): number {
  const knee = 0.7;
  const level = Math.abs(x);
  if (level <= knee) return x;
  return Math.sign(x) * (knee + (1 - knee) * Math.tanh((level - knee) / (1 - knee)));
}

function saturator(ctx: AudioContext, out: AudioNode, level: number): AudioNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve(gritShape);
  const makeup = ctx.createGain();
  makeup.gain.value = level;
  shaper.connect(makeup).connect(out);
  return shaper;
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  // Two and a half seconds: every burst reads from a random offset (up to 1.5s
  // for the debris ticks), so the buffer must outlast the longest layer.
  const length = Math.floor(ctx.sampleRate * 2.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// --- environment ---------------------------------------------------------

function audioContextCtor(): typeof AudioContext | undefined {
  const scope = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

function resume(ctx: AudioContext): void {
  // An unhandled rejection here would surface as a page error: swallow it.
  void ctx.resume().catch(() => undefined);
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage can be blocked (private mode, file://): default to sound on.
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Not persisting is fine; the toggle still works for this session.
  }
}

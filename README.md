# Broadside

A naval battle game for one player against the computer, in the spirit of the classic pegboard
board game: two moulded plastic trays, red and white pegs, and a fleet of illustrated cartoon
ships on an illustrated tabletop. It runs entirely in the browser — no server, no network
requests, no tracking, no dependencies at runtime.

`npm run build` emits a **single self-contained `dist/index.html`** (fonts and artwork inlined as
`data:` URIs) that works when you double-click it.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 — hot reload while developing
npm run build      # type-check, then write dist/index.html
npm run preview    # http://localhost:4173 — serves the built file
```

**Playing the built file offline.** `dist/index.html` is one file with everything inside it. Double-click
it (or drag it onto a browser) and it plays from `file://`; copy it to another machine, mail it,
drop it in a folder — it has no siblings to lose.

**An app window on macOS.** Open the game in Safari, then **File → Add to Dock…**. Safari installs it
as its own dock icon that opens in a plain window with no address bar. This works both from
`npm run dev` and from the double-clicked `dist/index.html`.

## Art & asset pipeline

The twelve illustrations — eight ship sprites, the tabletop, the title hero and the victory and
defeat cards — were **generated once** through the [Higgsfield](https://higgsfield.ai) API with
the `recraft/v4.1/text-to-image` model, then committed to the repo. The game itself never calls
Higgsfield, never sees an API key and makes no network request of any kind: it imports the
finished files and the build inlines them.

```
assets/original/            the paid originals, committed, never bundled
assets/manifest.json        what was generated: model, request body, request id, cost estimate
src/assets/**               the optimized WebP files the game imports
src/ui/assets.ts            the only module in src/ that imports an image file
scripts/generate-assets.mjs the pipeline — the only thing here that talks to Higgsfield
```

| | |
|---|---|
| `npm run assets:probe` | list the image models this key may call and price each candidate — **free** |
| `npm run assets:estimate` | per-asset and total USD, and which assets already exist and are skipped — **free** |
| `npm run assets:generate` | **paid**: generate the missing assets, download, update the manifest, then process |
| `npm run assets:redo -- <name> --yes` | **paid**: move one original aside and regenerate just that asset |
| `npm run assets:process` | originals → `src/assets/**`: background removal, trim, resize, WebP. No network |
| `npm run assets:placeholders` | draw labelled stand-ins locally for any asset with no optimized file yet. No network |

**Cost safety.** Image generation is billed per image, so spending is deliberate and hard to do
twice:

- `--generate` and `--redo` print the bill and then **stop** unless you also pass `--yes`;
- an asset whose original already exists is **never** regenerated — only `--redo <name>` touches it;
- the summed estimate is checked against `--max-usd` (default `3.00`) *before* the first paid
  request, and a failed estimate aborts the run without spending anything;
- requests go one at a time, and a failed *submit* is never retried automatically (a retry could be
  charged twice); only the polling `GET`s retry;
- the manifest is written after every single asset, so a crash can never lose something paid for;
- `--probe` and `--estimate` only ever call the free estimate endpoint.

**Credentials.** The API key lives in `.env`, which is git-ignored; `.env.example` lists the
variable names and no values. The npm scripts run `node --env-file=.env`, so the key is read only
through `process.env` — the script never opens `.env` itself, never logs a credential, never
writes one to the manifest and never puts one in an error message. Nothing under `src/` or in
`dist/index.html` references it: the shipped game has no idea an API was ever involved.

`--process` and `--placeholders` are free, offline and idempotent, so the background removal and
the output sizes can be re-tuned from the originals as often as you like.

## Rules

- The board is **12 × 12** — rows A–L, columns 1–12. "D4" is row D, column 4.
- Each side has a fleet of **8 ships, 24 cells in all**:

  | Ship | Length | | Ship | Length |
  |---|---|---|---|---|
  | Carrier | 5 | | Frigate | 3 |
  | Battleship | 4 | | Destroyer | 2 |
  | Cruiser | 3 | | Corvette | 2 |
  | Submarine | 3 | | Patrol boat | 2 |

- **Ships may not touch — not edge to edge and not corner to corner.** Every square around a ship
  has to be open water. The placement preview turns red when a ship would touch, and the forbidden
  ring around the ships you have already placed is tinted while you hold one.
- One shot per turn, strictly alternating. A hit does *not* earn a bonus shot. You fire first.
- A sunk ship is announced by name and its hull is revealed on the grid, sprite and all.
- **Clear water.** Because ships cannot touch, every unfired square around a ship that has just sunk
  is provably empty. Those squares are marked with a small dot, they stop accepting shots, and they
  do not count as shots. The computer gets exactly the same information and never fires at them.
- The game ends the instant one fleet is completely sunk.

## Controls

| | Placement | Battle |
|---|---|---|
| **Mouse** | Click a ship in the dock, hover the board for a preview, click to place. Click a placed ship to pick it up again. | Click a square in enemy waters. |
| **Touch** | Tap a ship, tap a square to aim, tap the same square again to place. | Tap a square. |
| **Keyboard** | `Tab` to the board, arrows to move, `Enter`/`Space` to place, **`R`** to rotate. `Home`/`End`/`PageUp`/`PageDown` jump to an edge. | Arrows to move the reticle, `Enter`/`Space` to fire. |

Buttons: **Rotate**, **Place randomly**, **Clear board**, **Start battle**; **New game** during a
battle (it asks first), **Play again** on the result card, and the speaker icon mutes the sound
(the choice is remembered in `localStorage`).

A win first plays a 10-second realistic "enemy ship destroyed" clip (generated once with Higgsfield Seedance 2.5 by `scripts/generate-video.mjs`, which refuses to run again once the file exists; Skip button; not shown with reduced motion), then the Victory card.

The big moments (hit, miss, sunk, victory, defeat) are short recorded effects from Pixabay, inlined into the build (credits: `src/assets/sounds/CREDITS.md`); the small interface cues are synthesized with WebAudio. It starts on your first click, and
the game is perfectly playable silently if a browser has no audio at all.

`prefers-reduced-motion: reduce` removes the peg-drop animation, the ripple and the pulses.

## Difficulties

The computer only ever sees what a human opponent would see: your hits, misses, sunk hulls and the
clear water around them. It never looks at your ship positions.

| | How it hunts | Mean shots to win a 12 × 12 game (300 seeded games) |
|---|---|---|
| **Easy** | Random fire; after a hit it pokes at random neighbouring squares. | ≈ 86 |
| **Normal** | Checkerboard-parity hunt; once two hits line up it follows the line. | ≈ 79 |
| **Hard** | Probability density: it enumerates every placement of the ships still afloat that is consistent with everything it knows, and fires at the most likely square. | ≈ 62 |

(144 squares, 24 of them occupied; a perfect-information player would need 24 shots.)

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | `tsc --noEmit` then the single-file production build |
| `npm run preview` | serve `dist/` on port 4173 |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint over the whole repo |
| `npm test` | Vitest — engine and AI unit tests, including seeded simulations |
| `npm run e2e` | Playwright: builds, serves, then plays a seeded game to the end |

URL parameters, used by the e2e test and handy for debugging:

- `?seed=7` — seed the run; the same seed always produces the same enemy fleet and the same
  computer play.
- `?fast=1` — drop the computer's "thinking" pause to zero.

## Architecture

```
src/engine/   pure, immutable, DOM-free game rules (the only place rules live)
src/ui/       views that render from state; no rules, no state of their own
src/ui/assets.ts  the one module that imports image files
src/styles/   tokens.css holds every colour; everything else derives from it
src/assets/   the optimized artwork, bundled into the single file
scripts/      the generate-once asset pipeline (never runs at play time)
tests/        Vitest unit tests + seeded simulations
e2e/          Playwright smoke test against the real build
```

The game opens on a **title screen**. That is a UI state, not an engine phase: the engine still
starts in `placement` and knows nothing about it, which is why "Play again" and "New game" return
to placement rather than to the title.

The engine is a set of pure functions over immutable values: `placeShip`, `fire`, `takeShot`,
`chooseShot` and friends all return new state and never touch `document`, `window` or
`Math.random` (randomness is an explicit seeded `Rng` argument — ESLint enforces this). `src/ui/app.ts`
owns the single `GameState` and re-renders the mounted screen whenever it changes.

**The two-player seam.** The engine is symmetric: it knows two *sides*, `player` and `opponent`,
and nothing in it is "the computer". The computer is a controller in the UI layer
(`src/ui/cpuController.ts`) that is handed an `OpponentView` — exactly the information a human
opponent would have — and answers with a coordinate:

```ts
chooseShot(view: OpponentView, difficulty: Difficulty, rng: Rng): Coord
```

Adding a second human therefore means replacing that one controller with a transport (hot seat, or
a socket that exchanges `takeShot` coordinates), not rewriting the game. Because the AI is typed
against `OpponentView` rather than `Board`, it is impossible for it to cheat by construction — and
the same type is what a remote player would receive.

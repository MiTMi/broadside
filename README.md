# Broadside

A naval battle game in the spirit of the classic pegboard board game: two moulded plastic trays,
red and white pegs, and a fleet of illustrated cartoon ships on an illustrated tabletop. Play
against the computer, or against a friend on another device over a room code.

It runs entirely in the browser: there is no server of ours, no account, no tracking and no
analytics. **Playing against the computer makes no network request at all** — an end-to-end test
watches every request, websocket and `RTCPeerConnection` to keep that true. Playing online needs
the internet, and exactly one runtime dependency, [PeerJS](https://peerjs.com) (MIT), which is
bundled into the page like everything else — see [Play online](#play-online).

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
drop it in a folder — it has no siblings to lose. (Online play is the one thing a `file://` copy
cannot do — PeerJS decides how to dial the broker from `location.protocol`, and there is no page
origin to speak of. Serve it over http(s) — `npm run preview`, or the published site — to play a
friend.)

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
- One shot per turn, strictly alternating. A hit does *not* earn a bonus shot. Against the computer
  you fire first; online, whoever created the game does.
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

## Play online

Two people, two devices, one room code.

1. Both open the game. One picks **Play online → Create game** and gets a six-character room code
   (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `0`/`O`, no `1`/`I`) plus a **Copy link** button, and on
   iPadOS/iOS the system **Share** sheet.
2. The other picks **Play online → Join game**, types the code (or just opens the shared link,
   which carries `?room=CODE` and goes straight to joining).
3. Both place their fleets at the same time; whoever created the game fires first. The loser of a
   game fires first in the rematch, and a rematch needs both players to ask for it.

**Where the moves go.** Nowhere except the other player's browser. The two devices exchange shots
and results over a **WebRTC data channel** — a direct connection between the two browsers,
encrypted end to end (SCTP over DTLS, as every data channel is). To find each other in the first place they use PeerJS's free public signalling
broker at `0.peerjs.com`: it learns the room id (`broadside-<CODE>`) and the connection metadata
two browsers need to meet — IP addresses and candidate ports — and nothing else. No fleet, no
shot, no result and no name ever goes through it. Nothing is stored anywhere; close the tab and
the room is gone.

**Your fleet stays yours.** Each device runs the rules for its *own* board only: it answers an
incoming shot with hit / miss / sunk, and learns about the other fleet only from the answers it
gets back. A ship's position crosses the wire exactly once — when that ship sinks — so a modified
client cannot ask where your carrier is; it was never sent. At the end both sides reveal their
fleets, and each checks the reveal against a SHA-256 commitment made before the first shot *and*
against every result it was given during the game; the result card says **Fleet verified** when
that checks out. (It is a friendly game, not a tournament: the check catches a lying client after
the fact, it does not prevent one.)

**Known limits**, all of which show a plain message and a way back to the title rather than a
spinner:

- **Some networks cannot connect.** The default relays PeerJS ships with (a Google STUN server and
  a shared public TURN) are free and unguaranteed; behind carrier-grade NAT, a strict corporate
  firewall or a VPN, two browsers may simply never meet. Joining gives up after 20 seconds.
- **The public broker has no SLA.** If it is down or blocked, creating and joining both fail with
  "Couldn't reach the connection service".
- **A backgrounded tab disconnects.** iPadOS and iOS suspend WebRTC when the tab is not in front or
  the device is locked; the other player sees "Connection lost". Reconnecting is not supported —
  create a new game.
- **Not from `file://`**, as above. Use the published URL or `npm run preview`.
- **Two players per room.** A third person joining is told the game is already full; the game in
  progress does not notice.

**Testing it without a network.** `?transport=local` swaps the WebRTC transport for one built on
`BroadcastChannel`: two tabs of the *same* browser find each other by room code with no broker and
no internet at all. That is what the two-page end-to-end test drives, and it is the fastest way to
see both sides of the online flow while developing.

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
| `npm test` | Vitest — engine, AI, protocol, transport and match unit tests, including seeded simulations |
| `npm run e2e` | Playwright: builds, serves, then plays seeded games to the end — solo, two-page online over `?transport=local`, and the no-network check |

No test of any kind touches the public broker or the internet: the PeerJS transport is unit-tested
against a mocked `peerjs` module, and the online end-to-end test runs on `?transport=local`.

URL parameters, used by the e2e tests and handy for debugging:

- `?seed=7` — seed the run; the same seed always produces the same enemy fleet and the same
  computer play.
- `?fast=1` — drop the computer's "thinking" pause to zero.
- `?room=CODE` — open straight into joining that online game (this is what "Copy link" copies).
- `?transport=local` — play online against another tab of the same browser, over
  `BroadcastChannel` instead of WebRTC. No broker, no network.

## Architecture

```
src/engine/   pure, immutable, DOM-free game rules (the only place rules live)
src/net/      protocol, room codes, commitments and the transports (DOM-free)
src/match/    a match as a state machine: SoloMatch and OnlineMatch behind one interface
src/ui/       views that render from a MatchView; no rules, no state of their own
src/ui/assets.ts  the one module that imports image files
src/styles/   tokens.css holds every colour; everything else derives from it
src/assets/   the optimized artwork, bundled into the single file
scripts/      the generate-once asset pipeline (never runs at play time)
tests/        Vitest unit tests + seeded simulations
e2e/          Playwright specs against the real build: solo, online, network
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

Adding a second human therefore meant replacing that one controller with a transport, not
rewriting the game. Because the AI is typed against `OpponentView` rather than `Board`, it is
impossible for it to cheat by construction — and that same type is what a remote player receives.

**The online seam.** Two interfaces carry the whole of it:

```ts
// src/match/match.ts — what every screen renders from
interface Match { readonly view: MatchView; start(board): void; fire(c: Coord): void;
                  requestRematch(): void; leave(): void; /* …change and sound callbacks */ }

// src/net/transport.ts — how the other device is reached
interface Transport { send(msg: Msg): void; onMessage(cb): void; onOpen(cb): void;
                      onClose(cb: (why: CloseReason) => void): void; close(): void; }
createTransport(kind: 'peer' | 'local', role: 'host' | 'guest', code: string): Transport
```

`SoloMatch` wraps the `GameState` and the CPU controller; `OnlineMatch` wraps a `Transport`, its
own board and a reconstructed view of the enemy's. The UI knows neither — it renders a `MatchView`
and calls `fire()`. `src/net/**` and `src/match/**` are DOM-free and ESLint-enforced to stay that
way; only `localTransport.ts`, `peerTransport.ts`, `roomCode.ts` and `commitment.ts` may reach for
`BroadcastChannel`, PeerJS or `crypto`.

Two transports implement that interface today — `peerTransport.ts` (WebRTC via PeerJS) and
`localTransport.ts` (`BroadcastChannel`, two tabs, used by `?transport=local` and the tests) — and
a third (a WebSocket relay, a Firebase document, anything that moves JSON both ways) would need no
change above the seam. The transport's job stops at moving opaque JSON: it never validates or
answers a message. `OnlineMatch` re-parses every single one, ignores anything that does not fit the
phase, the turn and the shot number, and drops a peer that sends five bad messages.

`peerTransport.ts` loads PeerJS through a dynamic `import()` — `createTransport` stays synchronous
and hands back a transport that buffers sends until the module and the peer are there — so a solo
player never executes a line of it. The header of that file has the table mapping every PeerJS
failure onto the five close reasons the UI has copy for.

**Dependencies.** `peerjs` (MIT) is the one entry under `dependencies`, and the only third-party
code that ships. It brings its own small ones — an event emitter, two binary codecs and
`webrtc-adapter` — which the bundler inlines along with it: about **114 kB** of the single file
(31 kB gzipped), none of it fetched at runtime and none of it executed unless you play online.
Everything else in `package.json` is a build or test tool.

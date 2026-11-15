# Railhold

A co-op tower-defense game. Each player designs an electromagnetic launcher (a railgun or a multi-stage coilgun) and the launcher's performance comes from circuit and electromagnetic physics, not from a stat table. Up to four players defend one base across 10 waves.

It runs entirely in the browser. There is no build step to play it and no game server.

## 1. Play it locally (fastest)

Requirements: Node 22.18 or newer. Nothing to install.

```bash
node scripts/dev-server.mjs 5173
# open http://localhost:5173
```

The dev server serves `deploy/vercel/` and provides an in-memory room-code API, so solo play, the Range and multiplayer all work on one machine (open two browser windows).

## 2. Put it on the internet so others can open a link

The folder `deploy/vercel/` is the complete site: plain static files plus two small API functions. It is already built; you do not need to run a build.

### Vercel (recommended)

1. Push the repo to GitHub (or use `vercel` from the CLI).
2. In Vercel: **Add New, Project**, import the repo, and set **Root Directory** to `deploy/vercel`. Leave Framework Preset as "Other". The included `vercel.json` already turns off the build and install commands.
3. Deploy. Solo defense, the practice range, the shop and the logbook work immediately.
4. For room-code multiplayer, add a database for the signaling mailbox: in the project go to **Storage**, add **Upstash Redis** from the Marketplace, and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`), which `api/signal.js` reads. Redeploy once so the functions see the variables.
5. Check `https://YOUR-SITE/api/health`. It returns `{"ok":true,"multiplayer":true}` when the database is connected, and `multiplayer:false` when it is not. Without it, the menu shows multiplayer as unavailable instead of failing.

The free tiers of Vercel and Upstash are enough: the mailbox is used a few times per join, and match traffic never goes through it.

### Other free hosts

Any static host works for solo play and the Range: Netlify, Cloudflare Pages, GitHub Pages. Upload the contents of `deploy/vercel/`. Multiplayer needs the `/api/signal` endpoint. On a host without it, either deploy that endpoint separately and set `signalUrl` in `config.js` to its full URL, or use Vercel for the site.

## 2b. How the game flows

- First visit: **Start the tutorial** on the menu runs a one-minute guided tour of the practice range (charge, elevation, reading the result, upgrades).
- **Shop**: ready-made launchers and single parts, bought instantly with credits. The same shop opens from the editor and from the in-match garage.
- **Between waves** press **Upgrade or edit launcher** to open the garage over the match. You never leave the game. A lone player has no build timer; with friends the build timer runs.
- **If the keep falls** the host chooses **Continue from wave N** (credits from cleared waves are kept) or **Restart from wave 1**.
- **Audio**: looping procedural music and synthesized sound effects (no downloaded assets). Master, music and effects volumes are in Settings.

## 3. How multiplayer works

- Choose **Play with friends**, then **Host a room**. You get a 6-character code (digits 2-9 and letters without I, L, O) and an invite link.
- Others choose **Play with friends**, type the code (case does not matter) or open the invite link.
- The host's browser runs the match in a Web Worker. Guests connect directly to the host over WebRTC. The server only passes the connection offer and answer once.
- If a guest drops, reconnecting with the same browser returns them to their seat during a run.
- Keep the host's tab open. If the host leaves, the match ends.

TURN relay (optional, recommended): set `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` in Vercel (Cloudflare Realtime TURN key) and redeploy. `/api/ice` then hands each player short-lived relay credentials, so strict networks can connect. `/api/health` shows `turn:true` when active.

Limits: without TURN, ICE uses public STUN servers only (editable in `config.js`). Strict corporate or some mobile networks need a TURN relay, which is not included; add one to `config.js` if you have credentials. A room is held for 2 hours.

## 4. Test and rebuild

```bash
npm install            # only for typescript and @types/node (typecheck); tests need nothing
npm test               # 92 tests: physics, shared protocol, engine, signaling
npm run dev            # same as the dev server above
npm run build          # rebuild deploy/vercel from source; needs Bun (https://bun.sh)
npm run e2e            # Playwright browser tests; needs playwright and the dev server running
```

Typecheck each package with `tsc --noEmit -p packages/physics` (and `shared`, `engine`, `apps/client`).

## 5. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Multiplayer is not available" | The Upstash database is not connected, or the project was not redeployed after connecting. Check `/api/health`. |
| "No open room has that code" | Code typed wrong, the host closed the room, or it is older than 2 hours. |
| Join hangs and then fails | The two networks cannot connect directly (needs TURN). Try the same Wi-Fi, or add a TURN server in `config.js`. |
| Progress is gone | Your profile is stored in this browser's localStorage. Clearing site data or a private window starts fresh. There are no accounts. |
| Text looks different from the screenshots | The game loads two web fonts (Fredoka, Nunito) from Google Fonts. If they cannot load (offline, blocked), it falls back to your system's rounded fonts; nothing breaks. To self-host, put the font files next to `index.html` and change the `<link>` in `index.html`. |
| No sound | Browsers block audio until the first click. Click anywhere, and check Settings. |

## 6. Repository layout

- `packages/physics`: circuit and EM models (RK4), energy ledger, validation tests.
- `packages/shared`: part catalog, wave table, protocol, fire-control solver.
- `packages/engine`: the game room (phases, power grid, firing, enemies, scoring). No I/O.
- `apps/client`: the UI (Canvas 2D) and workers. `scripts/build.ts` bundles it into `deploy/vercel/`.
- `deploy/vercel`: the deployable site and `api/` functions.
- `docs/`: PHYSICS, BALANCE, PROTOCOL, ARCHITECTURE, DECISIONS.

## 7. What was verified and what was not

Verified here: all 94 tests; clean typechecks; Chromium tests of the Range, solo defense (including a kill), the logbook, and two-browser room-code multiplayer (join, ready, start, enemies visible to the guest, guest fires), wrong and malformed codes; 60 fps frames in the arena while firing; the signaling logic against an in-memory store and a mocked Upstash REST client.

Not verified: the web fonts loading from Google Fonts (the sandbox cannot reach it, so the fallback fonts were what got tested), a real Vercel deployment, a real Upstash database, and WebRTC across different networks or NATs. These need your accounts and networks. See `docs/DECISIONS.md` for the other deviations (no Docker, Postgres, Fastify, React or three.js; Canvas 2D and hand-written validators instead).

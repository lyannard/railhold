# Decisions

## D1. Original scope note (superseded by D6 to D11)

The build environment had no route to the npm registry (`npm view vitest` failed with
`ENOTFOUND`) and no running Docker daemon (`docker info` printed the client section only).
The brief requires every dependency to be confirmed with `npm view`, pinned exactly, locked,
and every phase to pass its gate before the next starts. None of that is possible for
Fastify, `pg`, Vite, React, React Three Fiber, three.js, uPlot or the font packages, and
nothing Docker-related can be built or smoke-tested. Writing about 15,000 lines of server and
client code that could never be installed, type-checked or run would break working rules 1, 2
and 6, so phases 2 to 5 were not started.

`packages/physics` has no runtime dependencies, so it is fully buildable and testable here.

## D2. Test runner: `node:test` instead of Vitest

Vitest could not be installed offline. The physics tests use Node's built-in `node:test` and
`node:assert/strict`. Node 22 strips TypeScript types natively, so test files are `.ts` and run
directly. The test bodies use only plain assertions and port to Vitest by changing the import line.

## D3. TypeScript source style

Source uses `.ts` import specifiers and erasable syntax only (no enums, namespaces or parameter
properties) so Node can run it without a build step. Type checking uses the globally installed
`tsc` 7.0.2 with `@types/node` from the machine-wide tool directory, passed with `--typeRoots`.
No devDependency versions are pinned in `package.json` because they could not be verified
through the registry.

## D4. Starter designs live in `packages/physics`

The brief puts the part catalog in `packages/shared`. The CLI needs verified starter designs
before `shared` exists, so `starters.ts` holds them as raw electrical designs. When `shared`
is built, its catalog must reproduce these numbers exactly.

## D5. Slug aspect ratio must be at least 1

The brief gives the prolate demagnetizing factor for `m = ell_s / d_s >= 1` only. Rather than
invent an oblate formula, `validateCoilgunDesign` rejects slugs shorter than they are wide.

## D6. Event splitting inside RK4

Trigger times, trigger positions, thyristor current zero crossings and muzzle exit are located
by shortening the step to land on the event (second-order accurate). This is what makes the
convergence test (halving `dt` changes muzzle velocity by less than 0.01 %) achievable;
quantizing events to step boundaries would not meet it.

## D7. Discontinuities are booked into the ledger

When a thyristor opens, a crowbar clamps a capacitor, or a failure removes a module, the energy
that disappears from the state is added to `E_drop` (ordinary turn-off and clamps) or `E_fail`
(rating failures). This keeps the conservation identity exact across events.

## D6. Browser-hosted matches instead of a game server
Vercel functions cannot host WebSocket servers and the registry/Docker were unavailable, so the host's browser runs the engine in a Web Worker and guests connect over WebRTC. A tiny signaling API passes offer and answer.

## D7. Room codes and a signaling mailbox
6-character codes; Upstash Redis REST (via Vercel Marketplace) holds short-lived mailboxes. Without it multiplayer reports itself unavailable; solo and Range are unaffected.

## D8. Validators instead of Zod, Canvas 2D instead of three.js
Neither could be installed. Protocol validation is hand-written in `packages/shared`; rendering is Canvas 2D (plan view; side view in the Range).

## D9. Local-first profile
No accounts. Progress is stored in localStorage with a visible save indicator.

## D10. Fonts
System font stacks; Hanken Grotesk and B612 are named first but not bundled.

## D11. Aim solver
`solveElevation` uses bisection then Illinois regula falsi (about 8 flights per solve).

## D12. Visual direction: soft toy diorama, chunky UI
The first design (graphite, porcelain, oscilloscope bezel) was too dense and cold for a game. The UI now uses thick ink outlines, rounded pill buttons with a pressed-down shadow, a cream panel colour and one action colour (amber). The world is drawn with flat-shaded, outline-free low-poly shapes under a hazy sky. The oscilloscope and needle meters are kept because they show real solver output, but they sit behind an "Instruments" button during a match. Menu: three big actions (Play, Play with friends, Practice range). Editor: a one-sentence verdict, four key numbers, and secondary parts and numbers folded away.

Honest note: creature sprites are larger than their physical hit radius (0.5 to 0.8 m), because 1 px is about 0.7 m at default zoom. Lead assist snaps to the nearest enemy within 30 m of the cursor; the shot itself is still solved and swept against the true radius.

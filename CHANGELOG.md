# Changelog

## 1.0.0
- Physics package, shared catalog and protocol, game engine, browser client, room-code P2P multiplayer, Vercel-ready static deploy with signaling API, 92 tests and Playwright checks.

## 1.1.0
- Complete visual redesign (toy-diorama world, chunky UI, simplified menu, match HUD and editor). No physics changes.

## 1.2.0
- Charging about 3x faster (grid rebalanced). Blueprints are now "launchers" with one Shop (kits and parts, instant buy).
- Guided first-run tutorial, redesigned practice range layout (sidebar, labelled axes, nothing clipped at small heights), exact ground-crossing on the range trace.
- In-match garage between waves, solo build phase untimed, defeat offers retry from the lost wave or restart (new `retry` message).
- Procedural music and sound effects with separate volumes.
- New terminal-velocity physics test (94 tests). No change to the shot solvers.

# Railhold architecture

Status: Phase 0 and Phase 1 are implemented and verified (see `docs/DECISIONS.md`
for the verification environment). Phases 2 to 5 are specified here and not yet
built.

## Repository layout

```
packages/physics   pure TypeScript, zero runtime dependencies, no DOM, no Node APIs  [built, tested]
packages/shared    Zod schemas, part catalog, blueprint types, wave data, protocol    [not built]
apps/server        Node, Fastify, ws, pg                                              [not built]
apps/client        Vite, React, React Three Fiber, Zustand                            [not built]
docker, scripts    compose file, Dockerfile, play/stop/backup scripts, smoke test     [not built]
docs               this folder
```

## Module contracts: packages/physics

Every function is pure unless stated. Units are SI and every numeric field name
carries its unit suffix.

| Module | Inputs | Outputs |
|---|---|---|
| `constants.ts` | none | `MU0`, `G0`, `R_AIR`, `GAMMA_AIR`, `T_AMBIENT_K` |
| `config.ts` | none | every tunable number (step caps, thresholds, trace size, defaults) |
| `prng.ts` | `seed: number` | `mulberry32(seed)` returning `() => number` in [0, 1); `gaussian(rng)` |
| `materials.ts` | material id | `Material` record, `resistivity_ohm_m(id, T_K)` |
| `rk4.ts` | right-hand side `(t, y, dydt) => void`, state `Float64Array`, step `h` | in-place classical RK4 step using preallocated scratch |
| `bank.ts` | module spec, series count `s`, parallel count `p` | `{ C_F, Vrated_V, ESR_ohm, ESL_H, mass_kg, cost, energy_J }` |
| `trace.ts` | samples pushed during a solve | decimated arrays of at most `TRACE_MAX_POINTS` points |
| `railgun.ts` | `RailgunDesign`, `SimOptions` | `ShotResult` (see below), plus `railGeometry()` and `validateRailgunDesign()` |
| `coilgun-magnetics.ts` | slug and coil geometry | `Nd`, `muEff`, Wheeler `L_air`, smoothed overlap `g(z)` and `dg/dz`, `lncosh`, coil electrical values from AWG |
| `coilgun.ts` | `CoilgunDesign`, `SimOptions` | `ShotResult`, plus `validateCoilgunDesign()` |
| `launcher.ts` | `Blueprint`, `LauncherThermalState`, `seed` | `{ result, nextState }`; thermal mixing and cooling helpers |
| `atmosphere.ts` | altitude `h_m` | `{ T_K, p_Pa, rho_kg_m3, a_m_s }` (ISA troposphere) |
| `ballistics.ts` | projectile state and parameters, `dt_s` | in-place RK4 flight step, swept collision tests (sphere, capsule) |
| `eddy.ts` | speed, field, conductivity, area, length | `Rm`, braking force |
| `starters.ts` | none | the Starter Railgun and Starter Coilgun designs |

### ShotResult

A discriminated union on `ok`:

- `ok: true`: `status` is `MUZZLE_EXIT`, `FIZZLE` or `ABORTED_BY_FAILURE`. Carries muzzle
  velocity and energy, peak current and its time, the energy ledger and its worst
  closure residual, failures (kind, rating, limit, value, time, consequence),
  thermal results, the downsampled trace, `physicsVersion`.
- `ok: false`: `kind` is `SimulationDiverged`, `StepCapExceeded` or `InvalidDesign`, with a message.
  Solvers never return NaN or Infinity and never throw for physical input.

## Contracts for later phases (specified, not built)

- `packages/shared`: Zod schemas for blueprints (with `schema_version` and migration
  functions), part catalog, `waves.json`, WebSocket protocol types. Depends on `physics` types only.
- `apps/server`: REST (`/api/health`, auth, blueprints, profile, shots, runs) and a WebSocket
  endpoint. One `Room` per room code with a fixed 60 Hz accumulator tick and 20 Hz snapshots.
  `fire` runs `simulateLauncher` and spawns a projectile using `ballistics.ts`.
- `apps/client`: editor previews run `simulateLauncher` in a Web Worker, debounced at 100 ms.

## Future work (out of scope for v1)

Internet matchmaking, mobile or touch support, a map editor, voice chat, Lorentz-force
enemy projectiles, user-generated content sharing, monetization.

## Current runtime architecture
`apps/client` (UI, Canvas 2D) talks to a `Session`. `HostSession` runs `@railhold/engine` `Room` in `host.worker.ts` (60 Hz tick, 20 Hz snapshots) and serves guests over WebRTC; `GuestSession` sends inputs and renders snapshots, with a `SimClock` smoothing host time. `calc.worker.ts` powers the editor's live prediction. `deploy/vercel/api` holds the signaling functions. See DECISIONS.md D6 to D11 and PROTOCOL.md.

# Physics notes

Implemented in `packages/physics`. The models are integrated with RK4 and every shot carries an energy ledger (stored energy = kinetic + resistive losses + remaining field and capacitor energy + other terms), which must close to 0.1 %. The tests enforce this.

## Models
- Railgun: series RLC bank discharging through rails with position-dependent inductance gradient L', velocity-dependent back-EMF, rail and armature resistance with temperature, and Lorentz force 0.5 L' I^2.
- Coilgun: each stage is a capacitor-driven coil with a ferromagnetic slug, with self and motional inductance and a trigger position per stage. Coil k is centered at k times the spacing; the slug starts at minus the start offset.
- Flight: point mass with ISA drag and gravity, 4 substeps of 1/240 s in the game, swept collision against enemy capsules.
- Thermal: lumped heat capacity with cooling between shots.

## Known limitation
The Wheeler formula and the long-solenoid formula agree within 3 % only for coil length at least about 40 times the radius. At length 10 times the radius they differ by 8.5 %. The tests use the tolerance that is actually attainable and this is the reason.

## Game-side approximations
- Client tracers re-simulate flights for display only and ignore shield braking.
- Lead assist is a gameplay aid, not a physical effect.

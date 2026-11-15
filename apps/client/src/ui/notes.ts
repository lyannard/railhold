import { h } from '../dom.ts';

/** In-app physics notes. The full derivations and validity ranges are in docs/PHYSICS.md. */
export function notesContent(): HTMLElement {
  const eq = (t: string): HTMLElement => h('p', null, h('code', null, t));
  return h('div', { class: 'notes' },
    h('h1', null, 'Physics notes'),
    h('p', { class: 'muted' }, 'What the solver computes, so you can predict what a change does before you try it. Every shot runs the real equations at fixed small time steps. The energy ledger on each shot has to close to 0.1 % or the test suite fails.'),
    h('h2', null, 'Railgun'),
    h('p', null, 'Current flows down one rail, through the armature, and back up the other rail. The loop is an inductor whose inductance grows as the armature moves. The force is'),
    eq('F = ½ · L′ · I²'),
    h('p', null, 'where L′ is the inductance gradient set by the rail width, height and gap. Doubling the current quadruples the force. Wider gaps lower L′, so you need more current for the same push. Each bank is an RLC circuit: capacitor with its ESR, a pulse inductor, switch drop, busbars and the rails. The crowbar diode lets current continue after the capacitor empties, so the magnetic energy is spent pushing the armature instead of ringing back.'),
    h('p', null, 'High current crowds into the skin of the rails and armature, so the effective cross-section is smaller than the metal. Heating is computed adiabatically during the shot, and the temperature carries to the next shot. Above 60 % of the melting point rails count as damaged and lose output until repaired. The mount must resist the force pushing the rails apart; past its rating the mount fails and the launcher is disabled for the wave.'),
    h('h2', null, 'Coilgun'),
    h('p', null, 'A soft-iron slug is pulled into a coil that carries current. The force is'),
    eq('F = ½ · I² · dL/dx'),
    h('p', null, 'The inductance rises as the slug enters and falls as it leaves, so a stage must switch off, or its current must fall, before the slug passes the centre. Otherwise the coil pulls the slug back. A freewheel diode keeps the current from reversing. Iron saturates, so more current stops giving more force above the saturation point.'),
    h('p', null, 'Coil inductance uses Wheeler’s finite-solenoid formula with a demagnetising factor for the slug shape. Wheeler’s formula stays within 3 % of the long-solenoid formula only when the coil is about 40 times longer than its radius. Short coils like the ones in this game differ by up to 8.5 % from it, so the solver does not use the long-solenoid shortcut.'),
    h('h2', null, 'Flight'),
    h('p', null, 'After the muzzle the slug flies under gravity and quadratic drag in an ISA atmosphere. The drag coefficient follows a table against Mach number with a transonic rise. Integration is RK4. Collisions are tested along the path of each step, so fast slugs cannot jump through a target. The crosshair number is the flight time from this same flight model.'),
    h('p', null, 'Shield bearers carry a magnet. A conductive slug moving through it induces eddy currents that brake it. A non-conductive polymer dart is not affected.'),
    h('h2', null, 'Power'),
    h('p', null, 'The team shares one grid. Generation grows with each player. Chargers ask for power until banks reach the target voltage, and when demand exceeds supply the shortfall comes from a buffer, then every launcher is throttled fairly. A charge target below 100 % saves energy and heat at the cost of muzzle velocity, which scales with voltage.'),
    h('h2', null, 'Game rules that are not physics'),
    h('ul', null,
      h('li', null, 'Damage equals the kinetic energy at impact. Armoured enemies reduce it by a factor unless the momentum per frontal area reaches their threshold.'),
      h('li', null, 'Repairs between waves are free. A destroyed capacitor module or coil stage is removed for the rest of the wave.'),
      h('li', null, 'Enemy walk paths are straight lines from the spawn line to the base.'),
      h('li', null, 'Lead assist solves where the nearest enemy will be when the slug arrives. It does not change the damage or the physics.')),
    h('h2', null, 'Where the model stops'),
    h('p', null, 'The solver uses lumped circuits with skin-effect corrections, not a full field solution. It ignores armature plasma transition, rail erosion and vacuum effects. The blueprint editor refuses values outside the range where the formulas are valid, and says which field is the problem.'));
}

import { BALANCE_TIERS, GAME, PROTOCOL_VERSION, type ClientMessage } from '@railhold/shared';
import { Room, type Outgoing } from '../src/index.ts';

export const V = PROTOCOL_VERSION;
export const tier = (id: string) => BALANCE_TIERS.find((t) => t.id === id)!.blueprint;
export const ALL_PARTS = ['capacitor:C2', 'capacitor:C3', 'switch:SW120', 'switch:SW700', 'mount:M2', 'mount:M3', 'cooling:K2', 'cooling:K3', 'trigger:fiber', 'payload:aluminum', 'payload:copper', 'payload:polymer'];

export function send(room: Room, id: string, m: Omit<ClientMessage, 'v'> & Record<string, unknown>): void {
  room.handle(id, { v: V, ...m } as ClientMessage);
}

export function errors(evs: Outgoing[]): string[] {
  return evs.filter((o) => o.ev.e === 'err').map((o) => (o.ev as { code: string }).code);
}

export function newRoom(seed = 7, mode: 'defense' | 'range' = 'defense'): Room {
  return new Room({ seed, mode, code: 'TEST42', hostId: 'host' });
}

export { GAME };

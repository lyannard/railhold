import type { Audio } from './audio.ts';
import type { Profile } from './profile.ts';
import type { Session } from './session.ts';

export type Route =
  | { name: 'welcome' }
  | { name: 'menu' }
  | { name: 'editor'; id?: string; back?: Route }
  | { name: 'range'; id: string; tutorial?: boolean }
  | { name: 'lobby'; session: Session; blueprintId: string }
  | { name: 'workshop' }
  | { name: 'logbook' }
  | { name: 'settings' }
  | { name: 'notes' };

export interface AppCtx {
  profile: Profile;
  audio: Audio;
  go(r: Route): void;
  toast(message: string, kind?: 'info' | 'fault'): void;
  reducedMotion(): boolean;
  openNotes(): void;
}

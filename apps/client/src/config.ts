/** Runtime settings loaded from /config.js, which the host of the site can edit without rebuilding. */
export interface RuntimeConfig {
  /** Base path of the signaling API. */
  signalUrl: string;
  /** WebRTC ICE servers. Add a TURN server here if players behind strict firewalls cannot connect. */
  iceServers: RTCIceServer[];
}

const DEFAULTS: RuntimeConfig = {
  signalUrl: '/api/signal',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
};

export function runtimeConfig(): RuntimeConfig {
  const c = (globalThis as { RAILHOLD_CONFIG?: Partial<RuntimeConfig> }).RAILHOLD_CONFIG;
  return { ...DEFAULTS, ...(c ?? {}) };
}

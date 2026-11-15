// Runtime settings. Edit this file on the server; no rebuild is needed.
// signalUrl: where the room-code service lives. iceServers: add a TURN server here for players behind strict firewalls.
window.RAILHOLD_CONFIG = {
  signalUrl: '/api/signal',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
};

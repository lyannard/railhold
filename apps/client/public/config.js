// Runtime settings. Edit this file on the server; no rebuild is needed.
// signalUrl: where the room-code service lives. iceServers: STUN plus a TURN relay (ExpressTURN free tier)
// so players behind strict firewalls or mobile networks can still connect.
window.RAILHOLD_CONFIG = {
  signalUrl: '/api/signal',
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    {
      urls: ['turn:free.expressturn.com:3478?transport=udp', 'turn:free.expressturn.com:3478?transport=tcp'],
      username: '000000002110133007',
      credential: '4lx+az/w686xX4lOVT6Jl4YYWb0='
    }
  ]
};

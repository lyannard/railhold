# Protocol

Transport: one WebRTC data channel from each guest to the host. The guest creates the offer (non-trickle ICE, 4 s gather timeout). Signaling (`POST /api/signal`, JSON `{op, code, ...}`): `open`, `join`, `poll`, `answer`, `answer-get`, `close`. Host polls every second. Room TTL 7200 s, inbox and answer TTL 120 s, inbox max 8, SDP max 16000 chars.

Room code: 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.

Client to host (JSON, max frame 16384 bytes, 120 messages per second): `hello` (cid, name, unlocked), `loadout` (blueprint), `ready`, `start`, `next`, `aim` (x, z, elevation_mrad, lead), `fire`, `chargeTarget`, `leave`, `ping`.

Host to client: `{snap}` at 20 Hz, `{ev:[...]}`, `{welcome}`, `{refused}`. The host validates every blueprint (schema, physics analysis, unlocked parts, budget). The unlock list is self-reported by guests and can be spoofed; this is acceptable for a trust-based co-op room.

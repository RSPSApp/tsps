# WebRTC gameplay proof of concept

This POC carries the existing binary login and game packets over one reliable, ordered `game` DataChannel. The relay only forwards SDP, ICE candidates, and session lifecycle messages; after the DataChannel opens the browser closes its signalling socket. A selected `host` or `srflx` candidate is the direct-connect success criterion. A `relay` candidate means TURN is carrying gameplay and is not a successful direct-path result for this POC.

## Components and configuration

The relay requires one shared home-server registration token:

```sh
corepack yarn --cwd ../rsps-webrtc-relay install
WEBRTC_REGISTRATION_TOKEN=dev-token \
  corepack yarn --cwd ../rsps-webrtc-relay start
```

It binds to `127.0.0.1:8787` by default. Override this with `HOST` and `PORT`. Its public endpoints are:

- `GET /healthz` — liveness
- `GET /status` — world and active-signalling-session counts
- `GET /worlds` — currently registered POC world IDs
- `WS /signal` — signalling only

A minimal Caddy configuration is:

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

The root `.env` is shared by the client and server; package-local `.env` files
override it. The connector is disabled unless all three required server values
are set:

```dotenv
WEBRTC_SIGNAL_URL=wss://relay.example.com
WEBRTC_WORLD_ID=toby
WEBRTC_WORLD_TOKEN=dev-token
WEBRTC_ICE_SERVERS=[{"urls":"stun:relay.example.com:3478"}]
```

Then run `corepack yarn --cwd server dev` and `corepack yarn --cwd client start`
normally. The client reuses only `WEBRTC_SIGNAL_URL` and `WEBRTC_ICE_SERVERS`;
the world ID comes from `/worlds`, and the registration token is never included
in the browser build. Client-local `REACT_APP_WEBRTC_*` values can still override
the shared public settings.

`WEBRTC_SIGNAL_URL` may include `/signal`; a bare relay URL gets that path automatically. `WEBRTC_ICE_SERVERS` accepts the standard `RTCIceServer[]` JSON shape, including TURN entries with credentials when supplied privately.

The login server list discovers every registered world from the configured
relay. With no configuration, a client opened on localhost still defaults to
`ws://127.0.0.1:8787`.

## STUN with coturn

On the VPS, install coturn, permit inbound UDP 3478, and run STUN-only mode so the POC cannot become an unauthenticated TURN relay:

```sh
sudo apt-get install coturn
sudo turnserver --stun-only --fingerprint --listening-port=3478
```

Then configure both peers with `[{"urls":"stun:relay.example.com:3478"}]`. Host candidates are enough for same-machine/LAN testing, so the local loopback test can use an empty ICE server list.

TURN URLs can be supplied through the same ICE configuration, but public static TURN credentials must not be placed in browser configuration. If direct candidates prove insufficient, the next step is a short-lived TURN credential endpoint backed by coturn's shared-secret mechanism.

## Manual test

1. Run the relay locally with `WEBRTC_REGISTRATION_TOKEN=dev-token corepack yarn --cwd ../rsps-webrtc-relay start`.
2. For cross-network testing, start coturn as above or configure another STUN endpoint on both peers.
3. Start the home server with the four `WEBRTC_*` variables above, changing the relay URL to `ws://127.0.0.1:8787` for loopback.
4. Start the browser client, open the server list, and select the world discovered from the relay.
5. Log in, walk, and send chat. These exercise the unchanged binary login, movement, and chat packet paths.
6. Check both consoles for `[webrtc] ... ICE selected`. Confirm the selected local/remote candidate type is `host` or `srflx`, not `relay`.
7. The browser deliberately closes `/signal` after `game` opens. Confirm `/status` reports no active signalling session while walking and chat continue.
8. Open a second browser and confirm it receives a separate server session; closing either browser should remove only its matching peer.

Automated checks:

```sh
corepack yarn --cwd ../rsps-webrtc-relay test
corepack yarn --cwd server test:webrtc
corepack yarn --cwd server test:client-protocol
corepack yarn --cwd client test:webrtc-world-list
```

## POC limitations

The home server derives an address only from the selected ICE candidate. Browsers can conceal host addresses with mDNS and relayed candidates identify the relay, so an unavailable address is recorded as unknown and never replaced with client-supplied IP data. Any IP-based account policy therefore remains limited for WebRTC sessions until an independently trustworthy identity mechanism is added.

The server uses `node-datachannel` 0.32.1. It is a small N-API wrapper around libdatachannel with Node 22 prebuilds, but remains a native dependency; unsupported CPU/OS combinations need a C++ toolchain and a source build. Version 0.32.1 is pinned because the current 0.33.1 package's optional prebuild set does not resolve cleanly through this repository's Yarn setup.

The world display name comes from `name` in `world.json` / `world.local.json` (default `Old School RuneScape`), rather than `WEBRTC_WORLD_NAME`.

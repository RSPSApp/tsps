# Gateway

Lets the official OSRS client (revision 241, launched through [RSProx](https://github.com/blurite/rsprox))
play on tsps. The gateway speaks the OSRS protocol to the client with
[rsprot](https://github.com/blurite/rsprot) and opens one tsps WebSocket session per player, the
same way the browser client does, translating both ways.

```
official client ── RSProx ── TCP ──▶ gateway (GATEWAY_PORT) ── WebSocket ──▶ tsps (WEBSOCKET_PORT)
```

It is separate from `tools/runelite-gateway`, a single-client RuneLite demo that reads snapshots
from a server plugin instead of tsps's protocol; the two don't share code or ports.
[COVERAGE.md](COVERAGE.md) lists every tsps packet and what it becomes.

## Running

```bash
yarn start          # tsps, as usual
yarn gateway        # the gateway, in a second terminal
yarn gateway:test   # unit tests; the integration tests (it/) need `yarn start` running in this checkout
```

Tests that need `::` commands (teleports, instances) run as tsps's developer account: start tsps
with `DEV_USERNAME=<names>` (comma-separated) and run the tests with the same variable. They play
the last name, so you can play the first one meanwhile. Without it they're skipped; they also
skip while someone is logged in on the tests' account.

```bash
DEV_USERNAME=gwdev,gwtest yarn start
DEV_USERNAME=gwdev,gwtest yarn gateway:test
```

The gateway reads its ports from the root `.env`, the same block `scripts/wt` writes
([docs/worktrees.md](../docs/worktrees.md)): `GATEWAY_PORT` (43595 in the main checkout, 43900 + N
in slot N) and `WEBSOCKET_PORT`. It serves JS5 from the cache in `server/target.txt`.

The login key is generated on first start into `gateway/keys/rsa.txt` (not committed). Startup
prints its modulus for the RSProx target.

Gradle runs on any JDK 11+ and builds with a JDK 17 toolchain. The test client builds RSProx's
revision-241 protocol module from a pinned commit into `gateway/build/rsprox` on first run.

## Playing with RuneLite

RSProx launches the client, RuneLite or the native one, and connects it to the gateway. tsps
serves the jav_config and world list RSProx needs on its own port.

1. Start tsps and the gateway (above). `yarn gateway` prints the RSProx target: the jav_config
   URL, the game port and the login key's modulus.
2. Add it to RSProx's custom targets, `.rsprox/proxy-targets.yaml` in your home directory, with
   the printed values:

   ```yaml
   config:
     - name: tsps
       jav_config_url: http://127.0.0.1:<WEBSOCKET_PORT>/gateway/jav_config.ws
       revision: 241.1
       game_server_port: <GATEWAY_PORT>
       modulus: <printed by yarn gateway>
   ```

   Each worktree has its own ports and target. The modulus stays the same while
   `gateway/keys/rsa.txt` exists.

   For players on other machines, set two things in the root `.env`:
   - `PUBLIC_HOST`: the IP address or domain they reach the server at. The jav_config and world
     list give it instead of 127.0.0.1.
   - `GATEWAY_BIND_HOST=0.0.0.0` (or one interface's address): the gateway's game listener
     otherwise only takes connections from this machine. Behind NAT or a domain, `PUBLIC_HOST`
     needn't be an address of this machine, so the two are separate.

   Both `WEBSOCKET_PORT` (HTTP) and `GATEWAY_PORT` (game) must be reachable.
3. In RSProx, pick the target and RuneLite as the client, and launch it. Log in with a tsps
   account; unknown names are created, as in the browser.

Restart `yarn gateway` after pulling gateway changes. tsps restarts itself on server changes,
which logs everyone out.

### What doesn't work

[COVERAGE.md](COVERAGE.md) has every message. The ones you'll notice:

- tsps's own interfaces: `::teleports`, `::commands`, custom shops and the other plugin
  interfaces (group 30000 and up) aren't in the official cache
- browser-only features: the quest helper, voice chat, plugin HUDs and custom items (shown as
  their base item)
- camera target tracking and glides, which have no revision-241 form
- two players on one boat

### Reporting a problem

What helped most in fixing the gateway, roughly in order:

- **The RSProx recording:** RSProx writes a session to `.rsprox/binary/<target name>/` in your
  home directory, but only when the session ends, so log out first. RSProx recordings of live
  OSRS show what the official client expects for the same thing.
- **The gateway's `dropped:` line:** printed every minute, it counts what wasn't passed on.
  `missing:<group>:<component>` is an interface message for a component the client doesn't have.
- **RuneLite's log:** `.runelite/logs/client.log` in your home directory, for client errors.

## Layout

| Package | What |
| --- | --- |
| `config` | `.env` and `server/target.txt` |
| `crypto` | the login RSA key |
| `cache` | dat2/idx reader, containers, reference tables, the JS5 master index |
| `net` | rsprot's network service: JS5 from the cache, login, the 241 codecs |
| `tsps` | the tsps WebSocket and its wire format |
| `session` | per-player state; `GatewaySession` bridges one client to tsps; `EntityWorld` is its rsprot player/NPC/world-entity world |
| `down` | tsps → client translation, one file per domain (interfaces, items, world, social, trade, sync) |
| `up` | client → tsps translation (`Upstream`), with the gateway's own decoder for the character designer |
| `coverage` | counts of dropped messages, logged every minute |

## How it maps tsps to OSRS

[COVERAGE.md](COVERAGE.md) lists every tsps message and client opcode, the revision-241 packet it
becomes, and whether it is mapped, dropped (with a reason) or still to do.

Each official client gets its own rsprot entity world. tsps decides who a player sees, so the
gateway mirrors exactly that view rather than letting rsprot work out visibility.

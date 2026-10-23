# Checking behaviour in-game

Start the server with the agent MCP enabled (see [perf.md](perf.md)). These tools let an agent
run the in-game checklist a PR asks for, without a client.

For a quest start-to-finish run (Quest Helper route, stages/varps, rewards, relog and recovery),
use the checklist in [quest-testing.md](quest-testing.md).

| Step | Tool |
| --- | --- |
| Get players | `login` (any number of accounts), `logout`, `disconnect` (drops the connection without logging out, like a closed tab) |
| Set the scene | `command { player, text }` runs a `::command` as a developer for that call: `tele x y z`, `item id amount`, `master`, `cwar`, `toa` ... |
| Ask a rule | `can_attack { attacker, target: { player } or { npc } }`, `can_teleport { player, x?, y?, z? }` run the real checks and return the verdict and message, with no fight or teleport |
| Act | `walk_to`, `interact`, `npc_option`, `object_option`, `inventory_option` (Wear/Wield to equip), `use_item`, `player_option` (Attack/Trade/Follow), `cast_spell { spell, target? }` |
| Skip time | `advance_time { player, minutes }` moves timed content forward (farming, seedlings, bird houses) |
| Check the result | every action returns `area`, new `messages` and `client` (varbits, varps, interface opens/closes/hides and interaction modes sent since the last call); `observe { varbits, varps }` reads current values |

For example, Castle Wars friendly fire is: two `login`s, `command cwar` (or walk both into
the game), then `can_attack` between teammates (expect `CANT_ATTACK_IN_AREA` and the
message) and across teams (expect `CAN_ATTACK`).

A plugin with timed state opts in to `advance_time` by listening for the
`agent:advance-time` custom event (`{ player, ms, handledBy }`), moving its own deadlines
`ms` earlier and pushing its name onto `handledBy`.

What these can't check: how things look on screen, animation timing and feel, and anything
that depends on the real client's own scripts running.

## Seeing the screen (vision tools)

Two tools close that gap by driving a real headless game client through the worktree's own
client URL (PORT from the root `.env`; `VISION_CLIENT_URL` overrides). Every call boots its
own browser, logs the named player in through it, captures, and shuts down; arrange the
scene first with the tools above.

| Step | Tool |
| --- | --- |
| Screenshot | `vision_screenshot { player, yaw?, pitch?, run?, label? }` returns the PNG path |
| Clip | `vision_clip { player, seconds, yaw?, pitch?, run?, label?, }` returns the MP4 (10 fps screencast, ffmpeg) or JPEG frames when no encoder is available |

- **Camera:** yaw 0-2047, pitch 0 (level) to 512 (down); omit both to keep the player's view.
- **Runs:** pass the same `run` label across calls to group a session under
  `exports/<run>/`; without one, each call gets its own `<timestamp>-<username>` folder.
  Layout: `logs/run.log` (one tick-stamped line per call), `logs/harness-t<tick>-<label>.json`
  (one per call, named like its media), `screenshots/t<tick>-<label>.png`,
  `videos/t<tick>-<label>.mp4`. The tick ties media to the run.log lines.
- **Inspect:** read the PNGs/videos back; screenshots are also the fastest way to verify
  visual fixes a PR describes.
- **Toggles:** `VISION_EXPORTS=0` sends captures to the OS temp dir and writes no logs (use
  when probing without wanting to accumulate data); `VISION_KEEP_FRAMES=1` keeps clip frame
  JPEGs after a video builds (they are deleted otherwise); `VISION_CHROME_PATH` picks a
  specific Chromium (Chrome is preferred, Edge is the fallback).
- **Requirements:** a running client stack (`yarn start`) and a logged-out bot account
  (`VISION_BOT_PASSWORD`, default `vision1234`). A timed-out login (server restarting, ...)
  fails the tool with the saved login-screen path instead of pretending it captured gameplay.

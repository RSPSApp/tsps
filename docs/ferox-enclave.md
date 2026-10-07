# Ferox Enclave

`server/plugins/areas/FeroxEnclave.plugin.js`, with its parts in `server/plugins/areas/ferox/`: the town's barriers and safe ground (`Barriers.FeroxEnclave.js`), the Pools of Refreshment (`Pool.FeroxEnclave.js`) and the free-for-all portal and arena (`FreeForAll.FeroxEnclave.js`). `Common.FeroxEnclave.js` holds what they share: tick timing, the busy varbit and the full restore.

**Sources:**
- **OSRS captures** (rsprox): passing through a barrier both ways (once with the warning, once with "don't ask again"), drinking from a pool, and the free-for-all portal there and back;
- **the OSRS Wiki:** "Ferox Enclave", "Pool of Refreshment", "Free-for-all portal", "Exit portal (Clan Wars)", "Clan Wars".

All object ids and tiles are checked against this cache.

`Bounds.FeroxEnclave.js` holds the town's outline, the barriers (39652, 39653) and the buffer outside them. It moved here from `LootKeys.plugin.js`; LootKeys, LootingBag, the PvP presets and the Wilderness plugin now use it from here.

## Barriers
- **Leaving, the first time:**
  1. A message box (interface 229): "When returning to the Enclave, if you are teleblocked, you will not be allowed to enter the Enclave until the teleblock has worn off. You will also be attackable in the safe zone outside the Enclave if you are teleblocked." The last sentence is in red.
  2. Then "Continue through the Barrier?" with "Yes." / "Yes, and don't ask again." / "No.".
  3. "Don't ask again" sets varbit 10532 (`wildy_hub_warning`). It's saved per player and sent again on login.
- **Coming in:** no prompt.
- **Crossing:**
  - **On the choice, or straight away:** `busy` = 1; you face the way through; animation 4282 (`sos_security_door_drag`) and sound 4193 (2 loops, delay 30).
  - **A tick later:** a one-tile teleport through, `busy` = 0, and the animation is reset.
- **Teleblocked:** a teleblocked player can't come in: "A magical force prevents you from entering the Ferox Enclave while teleblocked." (our wording, kept from before).
- **Varbits:** 6549 (`pvp_adjacent_area_client`) is 1 inside the town, and 10530 (`wildy_hub_buffer`) is 1 in the buffer by the barriers. Both are kept up to date every tick near Ferox.
- **Not like OSRS:** in OSRS the buffer counts as Wilderness (varbit 5963 = 1). Here the Wilderness plugin counts it as safe ground, as before, so 5963 stays 0 there. Attacks there are still only allowed when someone is teleblocked.

## Safe ground
Players can't attack each other inside the town or in its buffer, unless one of them is teleblocked (Wiki). This was already in LootKeys and moved here unchanged.

## Pools of Refreshment
- **Captured:** animation 7305 (`poh_pool_drink`), "You feel reinvigorated after drinking from the pool.", varp 456 = −1 (disease), and `busy` from the next tick.
- **The restore (Wiki):**
  - every skill back to its base level, including hitpoints and prayer;
  - run energy to 100%;
  - poison, venom and disease cured;
  - all prayers turned off;
  - **not** special attack.
- **Ours:** `busy` clears 3 ticks after drinking (the capture ends before it does).

## Free-for-all arena

`FreeForAll.FeroxEnclave.js`, from two captures (the portal there and back; Disable-XP, a walk through the arena, the Mysterious Portal) and the Wiki.

**The portals:**
- **"Enter"** (26645): a teleport to 3327, 4751 a tick after the click, fully restored, as at the pool but with prayers left on (Wiki).
- **The exit portal** (26646, "Exit"):
  - **on arrival:** you face it;
  - **a tick later:** `busy` = 1 and a teleport back to 3128, 3629, facing north;
  - **a tick after that:** `busy` = 0.
- **"Disable-XP":** the question "Disable XP gains in Clan Wars?" (or "Enable…" once disabled), with "Yes." / "No.". Yes sets varbit 20231 (`clan_wars_xp_disable`) and shows "You will no longer gain XP in Clan Wars." / "You will now gain XP in Clan Wars." in a message box. The setting is saved per player, and XP is blocked only inside the arena.
- **The Mysterious Portal** (56373) shows "This portal is unavailable on this world.", with `busy` until you click continue.

**Inside the arena** (x 3264–3391, y 4736–4863, its own Area):
- **On entering:**
  - "Attack" on players;
  - varbit 8121 (`pvp_area_client`) = 1;
  - the PvP overlay with the safe badge (the crossed skull);
  - the free-for-all overlay (interface 199) on the HUD.
- **On leaving by any route:** all of that comes down and you're restored again (Wiki).
- **The line:** ground decoration 8875 runs across the arena at y 4759–4760. South of it, and on it, is a safe zone: "Attack" still shows (as captured at the landing tile), but nobody there can fight or be attacked. **The message is ours:** "You can't fight in the safe zone." (at most every 3 seconds).
- **PvP past the line (y ≥ 4761):** any player may attack any other, at any combat level, and nobody is skulled for it. The arena is not a `pvp` zone, so no Wilderness rules apply.
- **Multi-combat:** the northern part, from y 4800, is a `multi-combat` zone in `world.json`. The capture shows the multi icon from there. Its full width is assumed, since only the middle was walked.
- **Deaths are safe:** nothing is dropped, and any skull is kept (Wiki: since 2021). You come back outside the portal at Ferox (3128, 3629), restored. **Where you respawn is ours:** no capture or Wiki source says.
- **Meteors:** they fall in the north for show.
  - **Captured:** each is projectile 660, rising from a launch tile to a point 3–4 tiles away (cycles 0→60, height 0→1000), then falling to a landing tile beyond it (60→120), with blast graphic 659 (delay 120) and area sound 594 at the launch tile. Nobody is hurt.
  - **Ours (approximate):** the launch area (x 3297–3317, y 4818–4828, as seen in the capture), one every 4 ticks, and the random direction.
- **The "Attack" option** is sent with `sendPlayerOption(1, …)`, the packet this client reads. The older `sendInteractionOption` is a no-op here: `PlayerSession.write` drops unported packets.

**Not done:**
- **The level row:** the capture also shows the PvP overlay's level row. We leave it hidden, because its text comes from a cache script that only knows real Wilderness levels.
- **Music unlocks:** the server has no music unlocks, so the music follows the region.

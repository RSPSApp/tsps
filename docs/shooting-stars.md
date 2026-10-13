# Shooting Stars

Crashed stars land around the world. Players mine them layer by layer for stardust and trade the dust with Dusuri, by the Mining Guild (`server/plugins/skills/ShootingStars.plugin.js`, with its parts in `server/plugins/skills/shootingstars/` and its data in `server/plugins/skills/data/shooting-stars.json`).

The rules come from the OSRS Wiki (Shooting Stars, Crashed star, Celestial ring, Shooting Star Noticeboard). The texts, sounds, varbits, headbar and layer timing come from rsprox captures (https://rsprox.net/database): recordings 3142 (rev 232), 797, 796, 813 and 1850 (revs 227–234, event worlds), and a capture of Dusuri's first conversation and her shop.

Like OSRS, it is free-to-play, with half experience on free-to-play worlds, where Dusuri won't trade.

## Landing

- **When:** one star per world. A new star lands every 90 ± 15 minutes, and the first one 20–50 minutes after the server starts. A new star replaces one still standing.
- **Size:** 6–9, by the Wiki's crash chances: 6 = 25%, 7 = 30%, 8 = 25%, 9 = 20%.
- **Where:** one of the Wiki's 83 landing-site pins, never the same site twice in a row.
  - Stars land in members areas on free-to-play worlds too, as in OSRS.
  - The Wiki's Darkmeyer site isn't on its map and isn't included. In OSRS the Darkmeyer site is only used when the roll repeats the last site.
- **The landing itself isn't captured.** The cache's `star_landing_star` loc (41019) carries the impact animation (`game_star_meteor_impact`), so it stands for 4 ticks before the crashed star replaces it.
- **The crashed star** is one 2×2 loc per size, `star_size_<n>_star` (41020, 41021, 41223–41229).
  - An invisible `star_headbar_npc` (10629) stands on its south-west tile.
  - That NPC's headbar 1 (50 wide) shows how much of the layer is left.

## Mining

- **Mine:** the player turns to the star. A tick later comes "You swing your pick at the star." (spam), with the pickaxe's mining animation.
  - **Level:** a layer needs Mining level size × 10. The text for being under the level isn't captured; this server says "You need a Mining level of at least N to mine this layer."
  - **Pickaxe:** the Mining plugin answers which pickaxe to use (`mining:best-pickaxe`). The pickaxe's interval sets how often an attempt is made.
- **Each attempt** (Wiki):
  1. The uncut gem table is rolled first: 1 in 256, or 1 in 64.2 wearing a charged amulet of glory or the eternal glory. It gives a sapphire, emerald, ruby or diamond, or nothing (weights 32/16/8/2, and 70 for nothing). No stardust and no experience come with it.
  2. Otherwise, stardust is rolled: 29% at level 1 up to 46% at 99, the same for every size. Invisible boosts count.
- **A success** gives 1 stardust and synth sound 3600. It gives 32 Mining xp, or 16 on free-to-play worlds.
  - It emits `mining:success` with the star's base of 521,550. The Pets plugin rolls the rock golem from it, and the Mining plugin rolls clue geodes.
- **Layers:**
  - While anyone mines (or tried to this tick: the Wiki says the timer is checked before the level), the layer drops 1% every 7 ticks. The headbar loses a pixel every 14 ticks. In the captures, each layer lasts about 702 ticks.
  - At 100% the loc becomes the next size down, with area sound 4925. The old headbar comes down and a full one goes up. Everyone mining stops.
  - After size 1: "The star disintegrates into dust." (game message), the loc animation `game_star_meteor_despawn` (8865) and area sound 4923. The loc goes 2 ticks later.
  - A star nobody mines stays until the next one lands.
- **Discovery:** the first player to Mine a newly landed star finds it, whatever their level, and no mining starts on that click.
  - They get a message box, "Congratulations! You were the first person to find this star! Your star dust gain will be doubled for the next 300 dust you mine!", and jingle 287.
  - `star_bonus_dust` (15351) is set to 300. The client's buff bar shows it.
  - Each later success gives one extra stardust and counts it down. Every 50 there is a message: "Your star discovery bonus will grant you another N star dust before it runs out." At 0: "<col=ff3045>Your star discovery bonus has been used up."
  - The bonus is persisted and re-sent on login. Finding another star resets it to 300.
- **Prospect:** synth sound 2661 and a message box, "This is a size-7 star. A Mining level of at least 70 is required to mine this layer. It has been mined 50% of the way to the next layer." On a size-1 star it ends "…of the way to the core."
- **Varbits:** `star_mined` (11886) is set the first time a player mines or finds a star, and Dusuri's transcript asks about it. The captures also show `star_last_mined_size`, `star_last_mined_location` and `star_time_since_landed`, but no client script reads them, so they aren't sent.

## Dusuri

- **Who she is:** `star_trader` (10633) spawns at (3022, 3342). The client shows her as `star_trader_1op` (Talk-to) until `star_trader_met` (11887) is 1, then as `star_trader_2op`, which adds Trade.
- **Her dialogue** is her Wiki transcript in `npc-dialogues.json`:
  - She uses the introduction until the player has met her, then the standard dialogue.
  - The transcript's "Dusuri gains a 'Trade' right-click option" steps set `star_trader_met`. It is persisted and re-sent on login.
  - The plugin answers the transcript's conditions: whether the player has mined a star, whether they carry stardust, and whether it's a members world.
- **Her shop**, Dusuri's Star Shop, sells for stardust: Celestial ring (uncharged) 2,000, Star fragment 3,000, Bag full of gems 300, Soft clay pack 150. The stock is 50/50/100/1,000, as captured.
  - **Value message:** the live game's is "Celestial ring (uncharged): currently costs 2,000 stardust.". The shared shop code still prints "… currently costs 2,000 x stardust.".
  - **Buy-back price:** the Wiki says she buys at 80% of her price; the shared shop code pays 85%.

## Celestial ring

- **Boost:** worn, charged or not (and the celestial signet), it gives an invisible +4 Mining boost to success rolls. That covers crashed stars, and rocks through the Mining plugin's `mining:level-boost` request.
- **Charging:**
  - **Charge** (or using stardust on the ring) asks how much stardust to add: one charge each, up to 10,000.
  - **Uncharge** gives all of it back.
  - **Check** says how many charges it has.
- **Extra ore:** charged, it gives a 1 in 10 extra ore for rocks up to adamantite (`mining:extra-ore`, in the Mining plugin). A charge is spent for every such ore, whether it procs or not. Crashed stars spend none.
- The ring's messages aren't captured; the wording is ours.

## Clue geodes

Clue geodes come from the Mining plugin (`server/plugins/skills/mining/ClueGeodes.Mining.js`), so every rock and crashed star rolls them, using the Wiki's formula.

- **Formula:** 1 in ⌊⌊⌊base × 0.7⌋ / (100 + Mining)⌋ × tier⌋, where base is the rock's golem base.
- **Tiers:** beginner 0.2, easy 1.7, medium 2, hard 3.3, elite 10.
- **When:** each tier rolls only if the player doesn't already own a clue of that tier.
- **Messages:** "You find a clue geode!" is captured. The text for opening a geode isn't.

## Noticeboard

- The Shooting Star Noticeboard (41230) is at the Observatory.
- **Read** opens `star_noticeboard` (47). It shows the last five stars that landed on the world, oldest first, with who found each, and "Stars Personally Found: N".
- The times follow the Wiki's screenshot: "8 hour 41 minutes ago", "8 minutes ago". There is no capture.
- The world's list is kept in `server/data/saves/shooting-stars.json`.

## Config and commands

- `ShootingStars:intervalMinutes` (world.json `pluginConfig`, default 90): the minutes between stars. The ±15 minutes stay.
- `ShootingStars:announce` (default false): tells everyone online "A shooting star has landed in <region>." when one lands. Use it for small worlds; OSRS has no such message.
- `::star` (owner):
  - On its own, it shows the current star: site, size, layer % and finder.
  - `::star spawn [size] [here | site number]` lands one now. `here` lands it next to you.

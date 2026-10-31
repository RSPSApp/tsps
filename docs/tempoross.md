# Tempoross

Tempoross, the Spirit Anglers' skilling boss, built from the OSRS Wiki, live rsprox captures
(<https://rsprox.net/database>) and the rev 241 cache. It is one plugin,
`server/plugins/minigames/Tempoross.plugin.js`, which delegates to one unit per area in
`server/plugins/minigames/tempoross/`.

Status:
- **Done:**
  - the Ruins of Unkah: ferries, the rope ladder (Climb, Quick-climb, Solo-start), the lobby
    HUD and the 30-second departure;
  - a cove instance per departure, scaled to its crew;
  - the fight: intro, energy, essence, storm, submerging, enrage, win and loss, the HUD;
  - fishing spots (moving, and the jumping spot), the shrine, crates and cannons, supply
    crates, pumps, spirit pools;
  - the wave (tethering, masts and totems breaking, repairs), lightning and spreading fires,
    the torrent;
  - points, permits, kill count, personal bests; the reward pool, its net and casket;
  - the `::teleports` Minigames entry and `::tempoross` developer commands.
- **Not done:** listed under "Not captured" and "Follow-ups".

## Layout

| File | What it owns |
| --- | --- |
| `Shared.Tempoross.js` | Ids, sounds, colours and helpers such as the fade and the one-per-player action. |
| `Cove.Tempoross.js` | The instance, template/instance tile mapping, what everyone in it sees, joining and leaving. |
| `Fight.Tempoross.js` | Phases, energy/essence/storm, points, the HUD, the win and the loss. |
| `Records.Tempoross.js` | Kill count, permits, personal bests (saved attributes and their vars). |
| `Spots.*` | Fishing spots, the jumping spot, spirit pools, harpooning. |
| `Cannons.*` | Ammunition crates, loading, cannon fire, stored ammo, disabled cannons. |
| `Tethers.*` | Masts and totem poles: tether, untether, repair, walking while tethered. |
| `Attacks.*` | The wave, lightning and fires, the torrent, item losses. |
| `Shrine.*`, `Supplies.*` | Cooking; supply crates and water pumps. |
| `Lobby.*`, `Hosts.*` | The ruins, ferries and departures; Forfeit and Leave. |
| `Rewards.*` | The reward pool, the Spirit Angler's net, the casket. |
| `Commands.*` | `::tempoross [lobby\|info\|surface\|energy n\|essence n\|storm n\|wave\|lightning\|torrent\|points n\|permits n]`. |

Data: `server/plugins/minigames/data/tempoross.json` (tiles, timings, points, loot).

## Sources

- **Wiki:** [Tempoross](https://oldschool.runescape.wiki/w/Tempoross),
  [Tempoross/Strategies](https://oldschool.runescape.wiki/w/Tempoross/Strategies),
  [Reward pool](https://oldschool.runescape.wiki/w/Reward_pool), and the pages for the
  ammunition crate, spirit pool, fires, masts, totem poles, harpoonfish and the reward casket.
  Numbers (XP, catch rates, points, permits, loot) come from the Wiki.
- **Captures:** the fight in recordings 552, 1858 (rev 227) and 3275 (rev 234). All three are
  Leagues V worlds, so they give the structure, ids, messages and timings but not Leagues
  rewards: the `human_harpoon_league_trailblazer` animation, the `smokepuff` graphic, Forager's
  Pouch messages, instant cooking and the boosted XP drops are Leagues relics. The lobby and the
  ferries come from ordinary worlds: 96, 101, 324, 326, 327, 1098, 1437, 1788, 1845, 3169, 3285.
- **The cove template moved.** In rev 227-234 the cove template was at y 2944-3008; in the rev
  241 cache it is at y 2816-2880. Every captured cove coordinate below is already moved by
  y - 128 (the ammunition crate the captures place at (3038, 2978) is loc 40968 at (3038, 2850)
  in our cache).

## Places

| What | Where (rev 241) |
| --- | --- |
| Ruins of Unkah lobby | around (3150, 2840); the rope ladder 41305 at (3135, 2840), the ferry 41311 at (3145, 2842) |
| Ferry to the lobby | Ferryman Sathwood (10610) south of Al Kharid bank, (3271, 3144) |
| Ferry back | Ferryman Nathwood (10611) at (3149, 2843) |
| Reward pool | loc 41296-41304 (by reward count), Spirit Angler 10605 at (3153, 2831) |
| Cove template | map squares (47, 44), tiles 3008-3071 x 2816-2879, all four planes |
| Player arrival | the west ship, (3035, 2852) (captures: (3035, 2979-2980) and (3038, 2981)) |

Tempoross Cove is an instance: a copy of the 8x8 chunks at chunk (376, 352). Ships, cannons,
crates, masts, totems, shrines and water pumps all come with the template; NPCs are spawned.

### Spawns (captured, y - 128)

| NPC | Tile(s) |
| --- | --- |
| Tempoross (10572 surfaced, 10573 drawing in water, 10574 submerged/whirlpool) | (3043, 2845) |
| Inactive spirit pool 10570 / spirit pool 10571 | (3046, 2843), (3046, 2853) |
| Fishing spot north 10565 | (3037, 2868), (3038, 2868), (3048, 2873), (3051, 2866), (3051, 2867) |
| Fishing spot south 10568 | (3036, 2835), (3037, 2835), (3046, 2826), (3046, 2827), (3048, 2829) |
| Fishing spot with jumping fish 10569 | at the same tiles as the others |
| Ammunition crates 10576-10579 | (3038, 2850), (3038, 2848), (3056, 2850), (3056, 2848) |
| Cannoneers 10599-10602 | (3039, 2850), (3039, 2848), (3055, 2850), (3055, 2848) |
| Captain Dudi (west, 10587) | (3036, 2852) |
| Captain Pudi (east, 10585) | (3058, 2846) |
| First Mate Deri (north, 10593) | (3043, 2869) |
| First Mate Peri (south, 10596) | (3041, 2834) |
| Lightning clouds 10580 | over the island and ships, wandering |

Locs from the template (rev 241): masts 41352 (west, (3036, 2849)) and 41353 (east,
(3058, 2849)); totem poles 41354 (north, (3044, 2867)) and 41355 (south, (3043, 2833));
shrines 41236 at (3035, 2827) and (3039, 2873); cannons 41238-41241; ammunition crate locs
40968-40971 (empty), 40972-40975 (8+ fish), 40976-40979 (15+ fish); supply crates
40964 Hammers, 40965 Ropes, 40966 Buckets, 40967 Harpoons; water pumps 41000 (Use) and 41004
(Fill-bucket).

## Ids

| Kind | Ids |
| --- | --- |
| Items | raw harpoonfish 25564, harpoonfish 25565, crystallised harpoonfish 25566, reward casket 25590, tiny tempor 25602 |
| Interfaces | tempoross_hud 437 (overlay_atmosphere), tempoross_lobby_hud 687 (overlay_hud), fade_overlay |
| Varbits | tempoross_tethered 11895 (0 none, 1 north totem, 2 west mast, 3 east mast, 4 south totem); tempoross_current_points 11897; tempoross_rewardpermits 11936 |
| Varps | total_tempoross_kills 2934 |
| Client scripts | 4074 HUD update; 4068 wave overlay show; 4069 wave overlay hide |
| Seqs | tether 8868, tether loop 8869, untether 8870, cannon firing 8871/8872, lightning cloud 8875-8881, torrent 8882, disabled cannon 8883/8884 |
| Spotanims | fishing spot splash 3, harpoonfish projectiles 525 (cooked) / 528 (raw) / 1837 (crystallised), impact 1838, fire spread 1839, fire spawn 1840, torrent 1841/1842, water splash 1843, tether 1844/1845/1846 |

The masts and totem poles are multilocs on varbit 11895: a player tethered to that site sees
"Untether" (40998 mast, 41012 totem), everyone else "Tether" (40999, 41233). A broken site is a
different loc put in its place: "Damaged mast" 40996/40997, "Damaged totem pole" 41010/41011,
each with "Repair".

## The HUD (script 4074)

Sent on every change while the fight HUD is up, with 15 arguments:

| Arg | Meaning |
| --- | --- |
| 0 | true before Tempoross surfaces (the bars show the surfacing countdown) |
| 1 | points (red below 2,000, white from 2,000) |
| 2, 4 | energy and its maximum |
| 3, 5 | essence and its maximum |
| 6 | storm intensity, out of 350 |
| 7-10 | the four tether sites are whole (1) or broken (0) |
| 11-14 | fire warnings on the four areas (shown when 1) |

Energy and essence are stored ten times the Wiki's numbers (a cooked fish takes 150). A solo
player's maximum is 2683 energy and 2492 essence (captures); the Wiki gives the scaling from
about 2,600/2,500 per player solo down to 1,800/1,700 each with 40.

## The fight (captures)

- **Boarding:** Solo-start: +2 `human_reachforladder`, +3 "The Spirit Anglers weigh anchor and
  sail you out to face Tempoross.", jingle 171, sound 2163, the lobby HUD closes, the fade-out
  opens; +10 the player is in the cove.
- **Intro:** the HUD opens 3 ticks after arrival with arg 0 = true. The hosts say "Tempoross
  will surface soon, prepare yourselves!". The countdown bar rises 2 a tick from 130 to 240,
  then (about 60 ticks after arrival) "Tempoross has surfaced, keep those cannons firing!" and
  the bars show the real energy and essence.
- **Storm:** intensity rises 1 a tick from 0 while Tempoross is up. At 350 the fight is lost.
  It resets to 0 when Tempoross submerges.
- **Wave:** "A colossal wave closes in..." (red), Tempoross becomes 10573; the hosts say
  "Tempoross is drawing in water, prepare yourselves!"; +2 script 4068 (300); +13 the wave hits:
  tethered players get "...the rope keeps you securely upright as the wave washes over you."
  and 10 points, Tempoross is 10572 again with seq `fsb_spawn`, water splashes (1843) and debris
  locs 41292-41295 appear. Untethering sends script 4069 (60).
- **Lightning:** "A strong wind blows as clouds roll in..." (red); a cloud's shadow
  (41006) shows below it; +13 Tempoross plays `fsb_lightening_cast` (8905); then fires (NPC 8643 "Fire" with loc 37582 on its 2x2) start.
- **Surfacing:** every time (the first included) Tempoross becomes 10572 and plays `fsb_spawn`
  (8897).
- **Submerged:** when energy reaches 0: "Tempoross is vulnerable!" (cyan), Tempoross becomes
  10574 with `fsb_ready_to_whirl` (8900), the hosts say "Tempoross has submerged, fish from the
  whirlpools!", 11 ticks later the pools become 10571. The storm resets. Energy stays at 0 for
  those 11 ticks, then comes back 35 a tick (solo: full in 77 ticks); at full it surfaces again
  ("Tempoross has surfaced, keep those cannons firing!") and the pools go inactive.
- **Enraged:** after the third surfacing: "Tempoross has gathered too much energy. The storm is
  out of control!" and the hosts say "Tempoross has gathered too much energy!".
- **Win:** essence 0: "The skies clear as Tempoross retreats to the depths." (pink), "The
  Spirit Anglers will ferry you back to the Ruins of Unkah in 20 seconds.", "Subdued in
  <time>. Personal best: <time>.", "Points: <n>. Personal best: <n>.", "Reward permits: <n>.
  Total permits: <n>.", "Your Tempoross kill count is: <n>.", jingle 288; the hosts say
  "Tempoross has retreated to the depths!". Tempoross plays `fsb_death` (8904) and the hosts turn into their
  victory variants (10586, 10588, 10595, 10597, with "Leave"). A tick later the hosts and the
  cannoneers cheer (862); then the hosts dance every 5 ticks (`emote_dance` 866 or
  `emote_dance_scottish` 2106) and each cannoneer cheers again every 5-9 ticks. After 31 ticks: mesbox "Victorious, you sail back to
  the Ruins of Unkah to prepare for the next encounter...", then Captain Pudi: "Excellent work
  out there! The seas are safe for a little longer thanks to you!".
- **Loss:** mesbox "The force of Tempoross' storm forces the Spirit Anglers to sail back to
  safety...", jingle 289, then Captain Pudi: "Argh, we let that storm grow too fierce... As soon
  as it's safe we'll 'ead straight back out!".

## Interactions (captures)

| Action | Response |
| --- | --- |
| Harpoon a fishing spot | "You start harpooning fish."; on a catch "You catch a harpoonfish!", +5 points (see "Tick rates") |
| Harpoon a jumping spot | as above; on a bonus: "You manage to catch an extra harpoonfish as it jumps out of the water." |
| Cook-at the shrine | `human_cooking`, sound 2577; every 3 ticks "You successfully cook a harpoonfish.", +10 points |
| Fill a crate | "You start loading harpoonfish into the cannon."; every 2 ticks `human_cooking` (delay 1), sound 4959, one fish out, +65 points cooked / +20 raw; next tick the cannon's `loc_anim` 8871 (8872 on the east ship), area sounds 4949/4945 and projectile 525 from the cannon's muzzle tile ((3040, 2851), (3040, 2847), (3054, 2851), (3054, 2847)) to the middle of Tempoross (3047, 2849), start height 57, end 90, 100 cycles, with impact 1838 sent alongside (delay 100, height 24) |
| Fill after the fight is won | mesbox "The cannons aren't needed anymore." |
| Tether | `human_bone_sacrifice`, spotanim 1844, sound 1439 (2 loops), varbit 11895 set; +2 spotanim 1845 looping; "You securely tether yourself to the mast." / "...to the totem pole." |
| Untether | `human_pickuptable`, spotanim 1846, sound 2247, varbit 0; "You untether yourself from the mast." |
| After a wave | tethered players are untethered 2 ticks after the hit (captured at +2; done for them, not by a click) |
| Walk while tethered | "You must untether yourself to move away." |
| Repair | `human_poh_build`, sound 938, "You repair the mast." / "...the totem pole."; without a hammer: mesbox "You need a hammer to repair the mast." |
| Douse a fire | `skip_throw_bucketofwater`, sounds 1733 and 2412, "You extinguish the fire.", bucket of water to bucket, +40 points |
| Standing in a fire | every 2 ticks: "You lose some <col=ff9e7a>fish</col> and a <col=ff9e7a>Bucket</col> to the fire." (the items lost named in that colour) |
| Harpoon a spirit pool | "You start harpooning fish."; per scatter "The glowing fish scatter, shedding their magical scales.", +55 points |
| A supply crate | "You take a Hammer from the crate." / "You take some Buckets from the crate." |
| Fill-bucket at a pump | "You fill the bucket with water." |
| Points reach 2,000 | "You have earned enough points for a reward permit." |
| Ferry (Sathwood) | fade, +4 teleport to (3148, 2842), "You ride the little boat south to the Ruins of Unkah.", jingle 171, sound 2163 |
| Ferry (Nathwood) | +3 teleport to (3272, 3143), "You ride the little boat north to Al Kharid." |
| Lobby ladder Quick-climb | +3 teleport to (3134, 2840) |
| Lobby HUD (687) | "Players Ready<br><col=ffffff>None</col>" / "<n>", "Next Departure<br><col=ffffff>Awaiting players</col>" / "<n> seconds" |

## Tick rates

The captured fights ran the Raging Echoes relic that makes fishing attempts 1 tick faster and
cooks half the catch, so their fishing is quicker than on a normal world:
- **Harpooning harpoonfish:** a roll every 3 ticks (captured every 2, one faster).
- **Spirit pool:** a scatter every 4 ticks (Wiki: run energy "3% every four ticks"; about 18
  scatters per submerge, as Tempoross/Strategies counts).
- **Cooking at the shrine:** every 3 ticks (capture and the Wiki's 3-tick harpoonfish).
- **Filling a crate:** a fish every 2 ticks (capture; no relic touches it).

## Wiki numbers

- **XP** (base Fishing level L): catching a harpoonfish floor(450 + 550 (L - 35) / 64) / 100
  below 70 and floor(890 + 110 (L - 70) / 29) / 100 from 70; filling a crate ten times that per
  fish; a spirit pool scatter 1.1 times it. Crystallised fish give 20% more for filling.
- **Catch chance:** low 170 / high 255 (dragon 178/267, crystal 187/280) out of 256; the jumping
  spots give a bonus fish half the time.
- **Damage:** raw and crystallised 10 energy, cooked 15. A spirit pool scatter takes up to 12
  essence (boosts don't help).
- **Points:** fish 5, cook 10, load raw 20 / crystallised 20 / cooked 65, repair 40, douse 40,
  survive a wave 10, scatter 55. Capped at 32,000.
- **Permits:** 1 at 2,000 points, +1 per 700 more; the remainder is a linear chance at one
  more.
- **Attacks** only above 10% energy. A wave breaks each tether site with 15-25% chance
  (scaling with the storm). Fires take a hammer, rope, bucket, bucket of water or fish every 2
  ticks; each fire spreads twice; a wave puts every fire out.
- **Reward pool:** 1 reward per 3 ticks with Net, 5 with Big-search; 10 Fishing XP each;
  rolls by base Fishing level (tables in `server/plugins/minigames/data/tempoross.json`).

## Not captured (ours, from the Wiki's descriptions)

- **An untethered player hit by a wave:** they lose one tool and 1-3 harpoonfish, with the fire's
  message format ("You lose ... to the wave."). The Wiki's push of a few tiles is not done.
- **Fires:** a fire takes one tool and 1-3 harpoonfish every 2 ticks; how many fish is ours.
- **Lightning:** 4-8 strikes, half of them near players, on tiles a player can reach (flood
  fill from the west ship); a cloud NPC is spawned over each strike for its animations.
- **Torrent:** a quarter of the gaps between attacks get one, aimed at a cannon being loaded
  if any; its message to a loader ("The surge of lightning arcs from the cannon into you...")
  is the Wiki's trivia line.
- **Spirit pool damage:** 10-120 a scatter (the Wiki's maximum of 12, ten times over).
- **Energy regeneration for a crew:** every captured fight is solo (35 a tick of 2683). Ours
  scales it with the maximum, so any crew gets the same 77 ticks; a flat 35 gave a crew of
  several minutes of essence fishing.
- **The jumping spot:** watched from start to end in captures 552 and 1858 it lasts 41-44
  ticks; ours lasts 44.
- **Enraged storm:** 12 a tick, so the loss comes ~30 ticks after the enrage, as captured.
- **Messages with no capture:** "You have no harpoonfish to load.", "The crate holds <n>
  harpoonfish waiting to be fired." / "The crate is empty.", "You need a rope to tether
  yourself to the mast.", "You need a bucket of water to put out the fire.", "You need a bucket
  to fill with water.", "You have no raw harpoonfish to cook.", "You need a harpoon to fish
  here.", "There are no rewards for you to find in the reward pool.".
- The crystallised harpoonfish projectile and the east ship's views.

## Follow-ups

- Item perks the loot gives: tome of water charging, fish barrel, tackle box, spirit flakes'
  extra fish (if not already in tsps).
- The infernal harpoon's auto-cook and charges at the cove (it fishes as a dragon harpoon),
  barbarian (barehanded) fishing, and harpoon special attacks.
- Combat achievements, the Spirit Angler stats board, the Retired sailor's exchange, the hosts'
  Talk-to variants in the cove.
- The wave's push for untethered players.

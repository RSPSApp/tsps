# Gemstone Crab

A timed world boss in the Tlati Rainforest (`server/plugins/bosses/GemstoneCrab.plugin.js`). Behaviour is from the OSRS Wiki. The cave crawl, animations, graphics, HUD, burrow timings and the crab tiles are from two live captures. The rest of the design follows OpenRune-Server's `gemstone-crab` module (ISC licence).

## How it works

- **The cycle:** the crab (npc 14779, 5×5) rises at one of three mines and stays about ten minutes. It then burrows and leaves its shell (npc 14780, "Mine") for 90 seconds. It rises at a different mine 29 ticks after burrowing, so the shell is still there when the next crab is up.
- **Its hitpoints are its time left.** Max HP is its lifetime in ticks, and it loses one each tick. Players' hits show their damage but never lower it.
  - Captured: the HUD showed 75 of 1086 left, then 74 a tick later.
  - Its overhead bar is headbar 20, 120 wide, with fill 9 = ceil(75/1086 × 120).
- **Rewards:** the 16 players who dealt it the most damage may mine the shell once each, for three uncut gems.
  - Each roll is uncut dragonstone 1 in 500, otherwise by weight out of 32: opal 9, jade 9, red topaz 6, sapphire 3, emerald 2, ruby 2, diamond 1.
- **Its attacks:** max hit 1, crush, every 7 ticks. It focuses on one side (north, east, south or west), and every player on that side, beside or under its 5×5, can be hit (Wiki: "the quadrant it is focusing its attacks on"). It changes side as it changes target. The centre tile is safe.
- **Multi-combat:** each mine's area is multi-combat (`world.json`), so many players can fight it at once (Wiki: it "can be fought in large groups").
- **Combat XP** against it is 87.5% of normal (3.5 per damage instead of 4).
- **Messages** (Wiki), sent to the players at the crab's mine (OpenRune sends them to the whole world; neither the Wiki nor our capture says which):
  - "The gemstone crab burrows away, leaving a piece of its shell behind.";
  - "The top three crab crushers were A, B, & C!";
  - to each player who may mine: "You gained enough understanding of the crab to mine from its remains.";
  - to others who try: "Your understanding of the gemstone crab is not great enough to mine its shell.".

## The three mines

| Mine | Crab (south-west tile) | Cave (57631) | Crawl lands at | Area (HUD) |
| --- | --- | --- | --- | --- |
| 1 | **1271, 3171** | 1278, 3167 | **1277, 3168** | 1258-1284, 3158-3184 |
| 2 | **1351, 3110** | 1350, 3123 | 1351, 3122 | 1338-1364, 3096-3124 |
| 3 | **1238, 3041** | 1245, 3035 | **1246, 3038** | 1224-1250, 3029-3055 |

Bold values are captured; the rest are OpenRune's. OpenRune had mine 3's crab at (1237, 3042), and its landings at mines 1 and 3 one tile off. A "Gemstone crab director" (npc 14781) stands at (1251, 3034).

## From the captures

### Crawling to mine 3

- **Cave "Crawl-through"** (loc 57631):
  1. **Tick 0:** the player faces the cave and plays animation 11580. Sound 2454 plays (3 loops, delay 4), and the screen fades out (script 948, `[0, 255, 0, 0, 50]`). The HUD is hidden.
  2. **Tick 1:** `minimap_state` (6719) is set to 2 and `busy` (12393) to 1.
  3. **Tick 2:** the player is moved to the landing, facing north.
  4. **Tick 3:** fade in (`[0, 0, 0, 255, 50]`), then the minimap and `busy` are reset.
- **The crab's animations:** idle 12480, spawn 12481, burrow 12482, attack 12483, shell disintegrate 12484, shell idle 12485. It has no block animation: while being hit it played only its attack.
- **The boss HUD** is sent by the `BossHud` plugin ([boss-hud.md](boss-hud.md)). It is interface 303 `hpbar_hud`, opened at login into the toplevel's `hpbar_hud` pane (161/164 child 2, 165 child 10).
  - varp 1683 `hpbar_hud_npc` = the npc id;
  - varbit 6099 `hpbar_hud_hp` = time left;
  - varbit 6100 `hpbar_hud_basehp` = lifetime;
  - varbit 12401 `hpbar_hud_boss` = 1;
  - client script 2376 `hp_hud_open`, given 19 of its components;
  - the fade scripts 2887 (in) and 2889 (out) take 14 of its components and a transparency (255 and 0). Leaving the mine fades the HUD out and hides `hpbar_hud:hp` (303:5) 2 ticks later. Showing it fades it back in (2887 from 254) after 2376: a finished fade-out leaves the bar's parts at transparency 255, 2376 doesn't reset them, and 2887 (via 2888) returns at once when told to start from the transparency they already have;
  - the bar's colours (303:13, :14 and :15 set to 25600, 576 and 800).

### The crab burrowing at mine 2 and rising at mine 1

Ticks are counted from the burrow animation.

| Tick | What happens |
| --- | --- |
| 0 | The crab plays 12482 and graphic 3454 (`vfx_crab_boss_death`). Its headbar and the HUD's hp go to 0. |
| 1-3 | The HUD's script 2887 runs once each tick. |
| 2 | The messages: "The gemstone crab burrows away, …" and the top three. Loc 32740 (shape 10, rotation 0), an invisible blocker, appears on the crab's south-west tile. |
| 4 | The crab is gone and the shell (14780) is there, with graphic 3452 (`crab_boss_remains_idle_spot`). The top damage dealers get "<col=005f00>You gained enough understanding of the crab to mine from its remains." |
| 8 | The HUD's script 2889 (its fade-out) runs. |
| 29 | The next crab rises at mine 1 (1271, 3171) with 12481 and graphic 3454. Its lifetime was 1073 ticks. |

- The shell's blocker stays until the shell goes.
- The player also got varp 4825 (`total_gemstone_crab_kills`), and a "Gemstone crab director" (14782, `notimer`) was spawned; neither is built.
- Crawling into mine 1's cave landed at (1277, 3168).

## Guessed rather than captured

- **The lifetime:** a random 918-1086 ticks. The Wiki says about ten minutes, OpenRune uses 918-967, and the captures had 1086 and 1073.
- **Mine 2's landing and every mine's area** are OpenRune's.
- **The sides:** each side is a wedge from the crab's centre, with the diagonals on both of their sides (OpenRune's reading of the Wiki's "quadrant"). Each player hit gets their own 0-1 roll.
- **The multi-combat areas** are the HUD areas, so they're OpenRune's too.
- **Timings:** the shell crumbling over its last 4 ticks, its idle graphic replayed every 14 ticks, the HUD clearing 11 ticks after the burrow, and target switching every 3-6 attacks. All from OpenRune, except the HUD clearing, which is a guess.
- **Its hit chance:** 0 or 1 at random, without an accuracy roll.
- **The shell's other messages:**
  - "You swing your pick at the crab shell.";
  - "You mine an uncut opal from the crab shell.";
  - "You have already taken your share of this crab's shell.";
  - the inventory and pickaxe refusals;
  - "The crab shell has already crumbled away.".
- **The cave's message** when the crab is already at that mine: "The gemstone crab is already nearby.".

## Not built yet

- The HUD's green colours, since there's no packet to set a component's colour.
- The director's dialogue, and the kill count (varp 4825).
- The overkill rule ("no overkill experience loss").
- Ruby bolt specials treating it as 300 HP.

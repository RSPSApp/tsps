# Guardians of the Rift

The Runecraft minigame in the Temple of the Eye, built from the OSRS Wiki, live rsprox captures and
the cache. It is one plugin, `server/plugins/minigames/GuardiansOfTheRift.plugin.js`, with one
unit per part of the game in `server/plugins/minigames/guardiansoftherift/` (the Wintertodt layout).

Status: all six phases are built: the lobby, barrier, game loop, HUD and Power-up; mining, the
workbench, portals, rubble, Deposit Pool and essence pouches; the Portal Guardians and altars;
cells, barriers and rift guardians; the abyssal creatures and the fight; the rewards. The phases
are at the end.

## Sources

- **rsprox captures, rev 241 (normal worlds):** a recording on world 409 with three full games
  (October 2026) is the main source for timings, numbers and messages. A second one covers the
  temple entrance, the Bank Chest and the tarnished locket. The world was busy: Peek and the
  end of game say "lots of adventurers", and the power maximum was 91,800 to 108,000.
- **rsprox captures, rev 227 (Leagues V):** recordings 566, 1840 and 1848, used for structure
  only where rev 241 has nothing (their amounts can be relic-boosted). Recording 1693 (rev 226)
  is the Temple of the Eye tutorial.
- **OSRS Wiki:** Guardians of the Rift (and /Strategies), Rewards Guardian, the cell, stone,
  pouch and reward item pages. The Wiki sets the numbers no capture shows.
- **Cache (rev 241):** ids by gameval name, the HUD interface and its scripts, loc placements
  (`yarn dump:widget 746`, `dump:cs2 5980`, `dump:loc`). The plugin looks every id up by its
  gameval name.

## Ids

### Varbits and varps

| Name | Id | Notes |
| --- | --- | --- |
| `gotr_is_playing` | varbit 13691 | 1 while the player is in the current game. |
| `gotr_game_id_on_player` | varp 3400 | A random game id on joining, 0 on leaving or at the end. |
| `gotr_elemental_earned_this_game` | varbit 13686 | Elemental energy this game (0-1000). |
| `gotr_catalytic_earned_this_game` | varbit 13685 | Catalytic energy this game (0-1000). |
| `gotr_mining_count` | varbit 5667 | Fragments mined this game; Mining XP stops at 250. |
| `gotr_player_has_finished_game` | varbit 13688 | Set at the end of a game, cleared on joining the next. |
| `gotr_portal_bottom_visible` | varbit 13687 | 1 while the player is in the huge-remains area, so its exit portal shows. |
| `gotr_talisman_toggle_<rune>` | varbits 13693-13704 | "Toggle-talisman" per Portal Guardian (air ... blood). |
| `gotr_unlocked_needle` | varbit 13690 | |
| `gotr_colourful_fade_disabled` | varbit 13814 | Barrier "Visual-effects". |
| `gotr_cordelia_repair_pouch` | varbit 14672 | |
| `gotr_*` varps | 3395 (perm), 3399 (temp), 3402 (rewards perm) | The varbits above pack into these. |

`total_gotr_kills` (varp 3397) is the rifts closed. Points ("Total elemental energy"), searches
and the `gotr_perm_0` settings aren't in a var the server saves, so they are attributes
(`guardians-of-the-rift:*`, `Records.GuardiansOfTheRift.js`) re-sent at login.

### Interfaces and scripts

- **`gotr_hud` (746)**, opened in `toplevel:overlay_hud` while playing. Its onLoad is script 5979.
- **`gotr_overlay` (745)**, opened in `overlay_atmosphere` for a portal's colour fade. The fade is
  run by script 5984 (`gotr_overlay_portal [model, colour]`) and ended by 5985 (`gotr_remove_portal`).
  The pairs in the captures are:
  - `[44090, 15855475]` for the huge-remains portals;
  - `[44091, 527582]` for water, body and law;
  - `[44092, 16293385]` for fire and chaos.
- **Script 5980 `gotr_hud_update`**, sent every 2 ticks while playing, takes 11 ints:

| Arg | Meaning |
| --- | --- |
| 0, 1 | Elemental, catalytic energy this game. |
| 2, 3 | Great Guardian power and its maximum, in guardian stones. The bar and "Guardian's Power: N%" are 2/3. A game starts at 10% (9180/91800, 9420/94200 at rev 241). The maximum moves by 200 as players join or leave mid-game, which fits the Wiki's 250 stones a player and 200 past the 20th. After the close, arg 2 is 0. |
| 4 | Huge-remains portal direction (enum 4254: 1 E, 2 SE, 3 SW, 4 S), 0 for none. |
| 5 | Active elemental altar (enum 4270: 1 air, 2 water, 3 earth, 4 fire), 0 before the rift opens. |
| 6 | Active catalytic altar (enum 4271: 1 mind, 2 body, 3 cosmic, 4 chaos, 5 nature, 6 law, 7 death, 8 blood). |
| 7, 8 | Rift guardians alive / the cap (10), drawn as "7/10". |
| 9 | In the lobby, ticks to the rift opening; then ticks to the creatures' attack (200 from the open); then ticks to the altars' next change (33). Negative hides the timer. |
| 10 | Ticks the huge-remains portal stays open (44 from its opening). Negative hides it: live sends minus the ticks since it closed. |

### Locs (rev 241, the temple's own map; the copies around 2440,5720 are the tutorial's)

| Loc | Id | Where |
| --- | --- | --- |
| Barrier: open, closed, finishing up | 43700, 43849, 53263 | 3613,9483 (5x1) |
| Rewards Guardian | 43695 | 3610,9479 |
| Bank Chest | 43697 | 3619,9473 |
| Deposit Pool | 43696 | 3609,9487 |
| Workbench | 43754 | 3611,9486 |
| Weak cells / Uncharged cells | 43733 / 43732 | 3618,9486 / 3618,9488 |
| Essence pile (elemental / catalytic) | 43722 / 43723 | 3618,9490 / 3611,9490 |
| Guardians of Air, Water, Earth, Fire | 43701-43704 | 3617,9494; 3623,9500; 3623,9505; 3617,9511 |
| Guardians of Mind, Chaos, Death, Blood | 43705-43708 | 3612,9494; 3606,9500; 3606,9505; 3612,9511 |
| Guardians of Body, Cosmic, Nature, Law | 43709-43712 | 3608,9496; 3621,9496; 3621,9509; 3608,9509 |
| Inactive cell tiles | 43739, tiers 1-4 43740-43743 | 3608,9503 ... 3622,9503 (7 tiles) |
| Barriers on the tiles | `gotr_barrier_tier1..4` (+ `_3x3`) | |
| Abyssal Rift | 43713 | 3612,9526 |
| Guardian parts / remains | 43715-43718 | the temple's edges |
| Large guardian remains | 43719 | 3639,9497 and 3639,9508 (past the rubble) |
| Rubble shortcut (56 Agility) | 43724 / 43726 | 3634,9503 / 3636,9503 |
| Huge guardian remains | 43720 | 3589,9497 and 3589,9508 |
| Huge-remains exit portal | 38044 | 3593,9503 |
| Huge-remains entry portal | 43729 | spawned at the directions above |

### NPCs

The Great Guardian is 11403, Apprentice Felix (reward trader) is 11404, Apprentice Cordelia is
6717 and Tamara is 11426.

The rift guardians are 11408-11417: mind, body, cosmic, chaos, nature, law, death, blood, air,
water, earth and fire, in the order the captures name them.

The abyssal creatures are 11405 (pyramid/guardian), 11406 (walker) and 11407 (leech). The barrier
NPCs are 11418-11425 (tiers 1-4, each with a `_large` variant).

## The game (rev 241 captures)

Ticks from the rift opening:

| Event | Tick | Message |
| --- | --- | --- |
| Lobby countdown | -50, -16, -8, -3, -2, -1 | "The rift will become active in 30 seconds." / "...10 seconds." / "...5 seconds." / "3..." / "2..." / "1..." |
| Rift opens | 0 | Everyone north of the barrier joins: a new `gotr_game_id_on_player`, `gotr_is_playing` 1, `gotr_player_has_finished_game` 0, the HUD; `<col=ef1020>The rift becomes active!` (no closing tag) |
| | +1 | "Creatures from the Abyss will attack in 120 seconds." |
| Creatures attack | +200 | `<col=ef1020>Creatures from the Abyss begin their attack!</col>`; the first altar pair opens |
| First huge-remains portal | +256 to +266 | `<col=ef1020>A portal to the huge guardian fragment mine has opened to the <dir>!</col>` |
| Later portals | every 230-240 ticks | the same; each is open 44 ticks |
| 60% power | | `<col=ef1020>The rift burns intensely... More creatures from the Abyss are emerging!</col>` |
| 100% power (C) | | `@mes_hl_gre@The Great Guardian is fully charged.</col>`; the creatures die on C+1 |
| | C+2, C+18, C+27 | The Great Guardian says "Humans, I now have the power to close the rift. Thank you, brave ones.", "Now, for the final blow. Let the Scar be no more!", "Brace yourselves!" |
| Rift closed | C+32 | `@mes_hl_gre@The Great Guardian successfully closed the rift!</col>`, the four reward lines (see Rewards), `gotr_player_has_finished_game` 1, jingle 292, "The Portal Guardians will keep their rifts open for another 30 seconds." Players stay in until they leave or the next game opens. |
| Altars close | close +51 | "The Portal Guardians close their rifts."; the HUD's altars go to 0 |
| Lobby | close +54 | "The rift will become active in 30 seconds."; the guardian stones go and `gotr_mining_count` goes to 0 (65 catalytic stones in the capture). Cells stay. |
| Next game | close +104 | |

- A game lasted about 860 ticks on the captured world.
- **The open takes no items in the capture:** ten uncharged cells taken between games were all
  still held after "The rift becomes active!" (twice). The Wiki: fragments, essence and portal
  talismans go at the start of a new game; the plugin takes those and any stones, never cells.
- `@mes_hl_gre@` is coloured by the chatbox's transparency: 229628 on a transparent chatbox
  (Leagues capture), 06600c on the opaque one (the same green Mastering Mixology captured).
- **Loss (no capture):** the Wiki says the game fails at 0%. The plugin closes the rift without
  rewards and says "The Great Guardian has been defeated. The rift remains open." (our wording).
- **Altars:** one elemental and one catalytic Portal Guardian are active at a time, from the
  creatures' attack until 51 ticks after the close. The pair changes every 33 ticks, and each
  new altar differs from the one before (rev 241 captures). Active
  guardians play `statue_runestone01_active`, inactive ones `statue_runestone01_inactive` (loc anims).
- **Power:** each guardian stone fed adds one to the power (the HUD's units). The maximum is
  250 per player in the game and 200 for each past the 20th (Wiki). A solo game needs 250 stones.
  When a player leaves, the power is clamped to the lower maximum. Only stones fed complete the
  charge.
- **An empty temple** holds its lobby at the 30-second line (ours). Nobody hears the countdown and
  no game opens until someone is inside the barrier. No creatures come through a game everyone
  has left.
- **NPC chatter** (Tamara, Cordelia, Felix): "We need to power up the Great Guardian!", "We need
  more rift guardians!", "Take uncharged cells with you to charge them at altars!", "The cells here
  can be used to power up barriers and rift guardians!", "Remember to combine guardian fragments
  with pure essence!", "Imbued essence can only be made at altars. Keep an eye out for the right
  altars to open!", "We need to protect the Great Guardian!", "We need shield barriers up before
  anything comes through that rift!", "Don't forget that different cells produce different rift
  guardians!", "We need to assemble rift guardian before those creatures arrive!", "The essence
  piles here contain lots of rift guardian parts.", "Smashing!"

## Interactions (captures)

### The barrier

- **Quick-pass from the lobby:** the player steps two tiles through (3616,9482 -> 3616,9484 in one
  tick), `gotr_is_playing` 1 and the HUD opens. During a game the game id is set too: rev 241
  worlds let players join mid-game. In the lobby the id comes when the rift opens.
- **Pass:** no capture; it does what Quick-pass does.
- **Requirements (Wiki):** Temple of the Eye and 27 Runecraft. The refusal wording isn't captured:
  "You need to complete Temple of the Eye to help guard the rift." and "You need a Runecraft
  level of at least 27 to help guard the rift." are ours.
- **Closed barrier (`gotr_barrier_closed`, Leagues: worlds that lock the game):** mesbox "It looks
  like the rift is already being guarded. You must wait until they are done to join." Not used:
  only themed worlds can lock it.
- **The barrier loc** swaps to `gotr_barrier_noentry` (53263) when the game ends and back to
  `gotr_barrier` when the Portal Guardians close their rifts (capture 1840).
- **From the full charge until the Portal Guardians close their rifts, from outside:** mesbox "It looks like the adventurers
  within are just finishing up. You must wait until they are done to join."
- **Leaving through the barrier:** `gotr_is_playing` 0, game id 0, both energies 0,
  `gotr_mining_count` 0, the colossal pouch's guardian essence (`colossal_essence_pouch` 0) and
  the game's items go, and the HUD closes. The Wiki lists fragments, essence and portal talismans;
  the plugin also takes stones and cells.
- **Logging in** inside the game side puts the player in the lobby (3615,9480).
- **Peek** gives one of these mesboxes ("lots of adventurers" on a busy world; the plugin says
  it from 50):
  - "The rift is wide open. Creatures are flooding through from the Abyss! There were N adventurers inside when it opened. Great Guardian power: N%"
  - "Creatures from the Abyss are coming through the rift. There were N adventurers inside when it opened. Great Guardian power: N%"
  - "The rift was successfully closed. There were N adventurers inside when it opened."
  - "The adventurers within are recovering from guarding the rift. There were N adventurers inside when the rift opened."
- **Visual-effects:** a chat menu: "Your current preference is to not see colourful full screen
  effects." with "Enable them." and "Disable them.".

### Fragments, essence and the workbench (rev 241)

- **Mining** guardian parts, guardian remains, large remains (past the rubble) and huge remains:
  - "You swing your pick at the rock." (spam) and the pickaxe animation. The first success comes
    two ticks later, then one every pickaxe interval (3 ticks with a dragon pickaxe; every attempt
    succeeds). The interval comes from the Mining plugin (`mining:roll-interval`), so dragon,
    infernal and crystal pickaxes sometimes take 2 (42 of 252 gaps in recordings 566 and 1840).
  - Each success: "You manage to mine some guardian fragments." / "You manage to mine some
    guardian essence." (spam), sound 3600, 5 Mining XP, and `gotr_mining_count` up by the amount.
  - Per success: parts and remains 1-3 fragments, large remains 2-4, huge remains 4-6 essence
    (captured; the Wiki agrees). Mining enhancers (Varrock armour, celestial ring) double these on
    live; the plugin doesn't apply them yet.
  - At 250: "You have reached the limit of 250 resources mined for this game and will not be
    receiving further XP." Mining goes on without XP.
  - Before the rift opens: "There's no need to do that right now."
  - No pickaxe: mesbox "You need a pickaxe to mine this rock. You do not have a pickaxe which you
    have the Mining level to use."
  - Huge remains with a full inventory: mesbox "Your inventory is too full to hold any more
    guardian essence." and sound 2277.
- **Workbench, Work-at:** each tick the `gotr_chisel_essence` animation, sound 2586, one fragment
  out and one essence in, and Crafting XP of level/10 (1 to 5, Wiki). It stops with "You have no
  more guardian fragments to combine." or a full inventory (mesbox "Your inventory is too full to
  hold any more essence.", sound 2277). With no fragments: objectbox with the fragments, "You'll
  need at least one guardian fragment to craft guardian essence."
- **Rubble, Climb:** `death_human_climbing_down` (delay 10); a tick later a 4-tile exactmove
  over 90 cycles (3633 <-> 3637, y 9503, facing west) with sound 2454 x6 (delay 19), and sound
  2455 on landing. Wiki: 56 Agility, unboostable. The refusal ("You need an Agility level of 56
  to climb this rubble.") is ours.
- **Huge-remains portals:** `gotr_agility_portal_top` opens at east 3627,9503, south east
  3627,9493, south west 3603,9493 or south 3615,9487.
  - Enter: on arrival `gotr_portal_bottom_visible` 1, the HUD closes, `gotr_overlay` opens in the
    atmosphere slot with script 5984 `[44090, 15855475]`, and sound 1098.
  - Two ticks later "You step through the portal and find yourself in another part of the
    temple." (spam), the move to 3592,9503, and script 5985. A tick later the overlay closes and
    the HUD comes back.
  - The way back (`gotr_agility_portal_bottom_parent`, a multiloc shown by that varbit) is the
    same with the varbit 0, to 3608,9500.
  - With Visual-effects off, the plugin skips the overlay.
- **Deposit Pool:**
  - Deposit-runes: `human_leverdown_walkmerge`, every rune to the bank, "You deposit all of your
    runes into the pool." With none: "You have no runes to deposit into the pool."
  - Deposit-items opens the deposit box.
  - The game's items can't be banked: "A magical force prevents you from banking this item!"
- **Essence pouches** (`plugins/skills/runecrafting/Pouches.Runecrafting.js`):
  - A pouch holds one kind of essence. Its count and kind are varbits (`<size>_essence_pouch`,
    `<size>_essence_pouch_type`: 1 rune, 2 pure, 3 daeyalt, 4 guardian; 0 when empty).
  - Fill on a full pouch, or with nothing to fill it with, empties it (the left-click swap).
  - Messages: "You do not have any essence to fill your pouch with.", "The pouch contains guardian
    essence, so you can fill it only with more guardian essence.", "There is no essence in this
    pouch.", "There are forty guardian essences in this pouch.", "You do not have any free space in
    your inventory.", "Your pouch has decayed through use."
  - The colossal pouch holds 8/16/27/40 at 25/50/75/85 Runecraft (Wiki).
  - Decay is simplified from the Wiki. A pouch decays after about 270/261/120/320 essence stored
    (medium, large, giant, colossal), never while a Runecraft or max cape is worn. A decayed pouch
    holds 3/7/9/35 until repaired.
  - Leaving the game empties guardian essence from every pouch (`colossal_essence_pouch` went to
    0 on leaving in the capture).

### Portal Guardians and altars (rev 241)

- **Enter an active Guardian:**
  - On arrival the HUD closes, `gotr_overlay` opens with the altar's colours (script 5984) and
    sound 1098.
  - Two ticks later: "You step through the rift and find yourself at the <Rune> Altar." (spam),
    the move and script 5985. A tick later the HUD is back.
  - The altar's own portal (Use) comes back the same way to 3615,9491 with "You step through the
    portal and find yourself back in the temple."
  - The player stays in the game while at that altar. Teleporting anywhere else ends it.
- **Arrival tiles (captured):** air 2841,4829; water 2726,4832; fire 2574,4849; body 2521,4834;
  nature 2400,4835; law 2464,4818; blood 3239,4832 (the true Blood Altar, `blood_altar` 43479,
  exit `bloodtemple_exit_portal` 43478). Mind 2793,4828 is from the Leagues capture. Earth
  2655,4830, cosmic 2162,4833, chaos 2281,4837 and death 2208,4830 are the Runecrafting
  plugin's talisman tiles.
- **Overlay colours (script 5984 [model, colour]):**
  - air `[38742, 15724013]`
  - water, body and law `[44091, 527582]`
  - fire and chaos `[44092, 16293385]`
  - nature `[44089, 2809369]`
  - blood `[35737, 12262933]`
  - huge-remains portals `[44090, 15855475]`
  - Earth, mind, cosmic and death aren't captured; the plugin borrows the closest.
- **Guardian animations:** active Guardians loop `statue_runestone01_active`, the rest
  `statue_runestone01_inactive` (loc anims).
- **Refusals:**
  - A dormant Guardian: mesbox "The Guardian is dormant. Its energy might return soon."
  - Holding guardian stones: the Great Guardian's transcript "Human, I need the power of the
    guardian stones." then "You should feed the guardian stones to the Great Guardian before
    making more of them."
  - A missing quest: mesbox "You must complete Mourning's End Part II before you can enter this
    rift." The Wiki's quests are Lost City (cosmic), Troll Stronghold (law), Mourning's End
    Part II (death) and Sins of the Father (blood).
- **Crafting guardian essence** (Craft-rune; plain Runecraft outside a game):
  - human_runecraft with the runecrafting spotanim (height 92) and sound 2710.
  - Runes as normal crafting, one guardian stone an essence (elemental at air, water, earth and
    fire, catalytic elsewhere), and the altar's XP. The capture's 22 law essence gave 209
    (9.5 each). The Runecrafting plugin's XP table is corrected to the Wiki's
    (5/5.5/6/6.5/7/7.5/8/8.5/8.7/9/9.5/10, 10.5 at the true Blood Altar).
  - One uncharged cell is charged to the altar's tier, while no charged cell is held: "Your cell
    absorbs a small/moderate/high/immense amount of excess energy."
  - Cell tiers (Wiki): weak at air, mind and body; medium at water, cosmic and chaos; strong at
    earth, nature and law; overcharged at fire, death and blood.
  - Portal talismans (Wiki): 1/250 an essence unless Toggle-talisman turned them off, and they
    stack past one (capture 566); "You
    discover a strange talisman during the runecrafting process!" (Leagues capture).
  - Combination runes and polyelemental stones aren't built.
- **Portal talisman on its Guardian (Wiki):** enters even while the Guardian is dormant. It's
  used up unless the Guardian is active: "The portal talisman shatters and you find yourself at
  the altar it originated from." (captured).
- **Toggle-talisman:** flips `gotr_talisman_toggle_<rune>`. The chat line ("You will no longer
  find portal talismans at the Air Altar.") is ours.
- Lantern bonus runes ("Your lantern gets you a bonus rune.") come with the rewards phase.
- **Power-up on the Great Guardian (rev 241):**
  - Two ticks after the click: anim `human_runecraft_walkmerge`, spotanim `runecrafting` (height 92),
    sound 5369 and a `pyramid_waterstrike_travel` projectile to the Guardian (start 25, end 60,
    heights 100 to 146).
  - A tick later every stone leaves the inventory, the energy varbit rises and the XP lands:
    5 Runecraft XP a stone (64 stones: 320).
  - Energy is 2 a stone for air, water, fire, nature and body stones (64 -> 128, 61 -> 122,
    13 -> 26). Twice in the recording, 62-64 law stones gave 4 a stone (256 and 248); the Wiki
    says 2 for every stone and the stones are the same item, so the plugin gives 2 (3 for
    polyelemental and polycatalytic, Wiki). Worth a recheck with death or blood stones.
  - Wiki: 1% run energy a stone, plus 1-11% from the special attack bar.
  - Without stones or while it rests, the Guardian's transcript (npc-dialogues.json): "The Great
    Guardian seems to be resting. You should probably not disturb it." (captured), "My power level
    is too low. Bring me guardian stones." or "Thanks, adventurer. I am now fully powered up."
- **Deposit Pool, Deposit-runes:** anim `human_leverdown_walkmerge`, every rune banked, and "You
  deposit all of your runes into the pool."

### Cells, barriers and rift guardians (rev 241)

- **Cell tables:**
  - Both tables: `human_pickuptable_walkmerge`, sound 2581.
  - Uncharged cells: Take-10 tops the stack up to ten, Take-1 adds one. At ten: mesbox "You can
    only carry ten of these at a time."
  - Weak cells: Take gives one weak cell. Take-chisel gives a chisel (`human_pickuptable`, sound
    2582).
  - The cells and talismans are destroyed when dropped: "The Uncharged cell is destroyed as you
    drop it." (spam), sound 2739.
- **The seven cell tiles** (`gotr_cell_tile_*`, shape 22) and their barriers (captured):

  | Tile | Barrier |
  | --- | --- |
  | 3608,9503 | 3605,9502, 3x3 |
  | 3609,9507 | 3607,9507 |
  | 3611,9509 | 3610,9510 |
  | 3615,9510 | 3614,9511, 3x3 |
  | 3619,9509 | 3619,9510 |
  | 3621,9507 | 3622,9507 |
  | 3622,9503 | 3623,9502, 3x3 |

  Each barrier has an invisible NPC on its tile (`gotr_barrier_npc_tier<n>[_large]`; the cache
  gives 50/100/200/400 hitpoints).
- **Place-cell** (`human_pickupfloor`; the best charged cell held; before the open, an uncharged
  cell on an inactive tile when no charged cell is held):
  - **Inactive tile:** the tile and barrier take the cell's tier, sound 5455 (tutorial capture).
    Wiki energy 17/20/24/30 of both kinds.
  - **A stronger cell:** "The strong cell is consumed as it <col=ff0000>strengthens</col> the
    barrier.", sound 5441. The barrier and its NPC go up a tier. Energy +7/+13/+22 (medium,
    strong, overcharged), XP +10 over recharging (190, 260 captured).
  - **Otherwise:** "The weak cell is consumed as it <col=ff0000>recharges</col> the barrier.",
    sound 5428. Energy +2/+5/+9/+15, Runecraft XP 30/100/180/250 (captured), and 10/25/50/100
    health back (Wiki).
  - Recharging a full barrier stops paying at 2,500 XP and 450 energy a game (Wiki).
  - With no charged cell, the plugin shows an objectbox: "You need a charged cell to place on the
    tile." (our wording).
- **A barrier destroyed:** "<col=ef1020>A barrier has been destroyed!</col>" (Leagues capture).
  - The tile becomes `gotr_cell_tile_broken_repairable`. Repair takes 12 guardian fragments and
    gives 25 of each energy (Wiki).
  - The plugin's refusal ("You need 12 guardian fragments to repair the cell tile.") is ours.
- **At 60% power** every barrier takes 50 damage (Wiki). **At the close** every tile goes back to
  inactive and the barriers go (captured).
- **Assemble at an essence pile** (captured, from arrival):
  - 0: "You scrape together what usable components you can find." (spam), `human_pickupfloor`,
    sound 942 x2.
  - +2: "You carve out a place for the cell and carefully place it inside the guardian." (spam),
    `gotr_chisel_guardian`, sound 2586 x2.
  - +4: the guardian rises (`rift_guardian_spawn`). The pile is removed for 6 ticks.
  - +5: the cell is used up, "The powers of the weak cell extend into the essence. A Guardian
    comes to life.", sound 956, 80 Crafting XP and the cell's Runecraft XP. The pile's energy is
    6/15/27/45 (Wiki: 2x+1 of the strengthening value), of the pile's kind only.
  - With ten guardians up: "The powers of the cell extend into the essence, but no guardian
    forms." The energy still comes.
  - No charged cell: objectbox (weak cell) "You will need a charged cell to power any rift
    guardians you create from this essence pile."
  - No chisel (Wiki: needed): "You need a chisel to carve the essence into a guardian." (ours).
  - Guardians: weak air or mind, medium water or chaos, strong earth or death, overcharged fire or
    blood.
  - Live raises a guardian on the pile itself. Here it stands up on the pile's north edge, so the
    2x2 and 3x3 guardians can walk out to their posts between the barriers and the rift.
  - All guardians die at full power (Wiki). The HUD's "n/10" counts them.
- **Players may place cells and assemble guardians in the lobby** (captured between games). Both
  the barriers and the guardians carry into the game.
  - The capture: the tiles reset at the close, then players built weak barriers over the next 26
    ticks and strengthened two of them to tiers 2 and 3, all before the next open.
  - Wiki (13 November 2024): before the game begins an uncharged cell builds a weak barrier, and
    this gives no experience. The plugin pays neither XP nor energy for cells placed before the
    open (energy would be wiped by it anyway).
- **One charged cell at a time** (Wiki): Take on the weak cells refuses while one is held; the
  refusal's wording ("You can only carry one charged cell at a time.") is ours.
- Once the quest is done, Temple of the Eye no longer spawns its owner-only Cordelia, Felix, Tamara
  and Great Guardian. The minigame's world spawns stand there.

### Abyssal creatures and the fight (rev 241)

- **Batches** (captured):
  - From the creatures' attack, they come out of the rift in batches 76 ticks apart, with
    `abyssal_demon_teleport` map anims (height 90) where they appear (3613-3617, 9522-9525).
  - A busy world (about 450 players) had batches of 13-22: two thirds leeches, a quarter walkers,
    the rest abyssal guardians.
  - The plugin sends max(2, min(22, players/30 + 2)): two on a quiet world, 17 at 450 players.
  - After the 60% surge the mix leans to walkers and abyssal guardians (Wiki).
- **Stats:** the cache gives the leech 5, the walker 30 and the abyssal guardian 50 hitpoints.
  Rift guardians have 10-50 and barriers 50/100/200/400.
- **Hits** (captured hitsplats):
  - Creatures on barriers and rift guardians, and rift guardians on creatures, hit 0-6. About
    four in ten are zeros.
  - The plugin uses a 60% hit chance and max hits of leech 2, walker 4, abyssal guardian 6, and
    rift guardians 3-6 by cell tier. Everyone attacks every 4 ticks. These are ours.
- **Animations** (`npc-combat-defs.json`):
  - The creatures use their `gotr_abyssal_*` attack, defend and death sequences.
  - Elemental guardians (11414-11417) only fight beside a creature, with
    `rift_guardian_attack_melee` and `_defend_melee`; catalytic ones (11408, 11411-11413) only at
    range (within 7), with `_attack_ranged` and `_defend_ranged` (capture 1840). Both die with
    `rift_guardian_death`.
  - A hit that doesn't kill plays the target's defend sequence (9388/9391/9395 for the creatures).
  - Barrier NPCs have none. Every one has respawn 0.
  - The rift guardians' captured projectile has no graphic (spotanim -1), so none is drawn.
- **Targets** (Wiki):
  - Creatures go for the nearest standing barrier, else the Great Guardian.
  - They fight back only against a rift guardian that struck them, while it's beside them.
  - Rift guardians go for the nearest creature within 10 tiles.
- **The Great Guardian** plays `9372` every 50 ticks of a game (capture 1840). The close's map anims
  (2064 x3, sound 5406) aren't built. Each creature hit drains its power. The busy world's barriers never let
  one through, so the drain (leech 1, walker 2, abyssal guardian 3 a hit) is ours. At 0% the game
  is lost.
- **At full power** every creature and rift guardian dies (Wiki).
- **Damage to these NPCs** lands directly, with their splat. Core NPCs heal 10% a tick when the
  combat system hasn't hit them for 20 seconds, so every GotR NPC is flagged `combat:no-regen`.
  Walkers and guardians are flagged to walk through other entities.

### Rewards

- **End of game:** see the Power-up section above for the captured lines. The points and the XP
  both need 300 energy in the game (Wiki). Each closed rift counts in the collection log's
  Guardians of the Rift category.
- **Pearls:** [Abyssal pearls](https://oldschool.runescape.wiki/w/Abyssal_pearls) are the
  minigame's reward currency. Here they are a saved balance (`shop-currency:Abyssal pearls`,
  the Shopkeepers point-currency convention), not an inventory item, so relogging keeps them
  and Felix's shop and Cordelia spend the same number. A won game pays each player who made a
  valid contribution `1 + performance / 100` pearls (performance is contribution points plus
  energy, capped at 100); standing in the game without doing anything pays none. A
  Rewards Guardian pearl roll credits the same balance, and with no points 25 pearls buy one
  search. Accounts from before the currency change have their inventory and bank pearl items
  converted into the balance once, on login; the items are removed in the same save. The
  per-game rate is ours; the Wiki's 14-16 pearls belong to the Guardian's loot table.
- **Rewards Guardian** (captured):
  - Check: mesbox "You have 3 catalytic energy and 2 elemental energy. You can use them to search
    the rift 2 times. You have searched the rift 4,003 times."
  - Search: `picking_low_shorter` a tick after the click. Then a reward every 3 ticks (the
    animation again): "You found some loot: 125 x Chaos rune" (spam), sound 2581.
  - When the searches run out: mesbox "There doesn't seem to be anything else in the rift for
    you." With none at all: "There doesn't seem to be anything in the rift for you."
  - Big-search: the animation, and three ticks later up to five rewards at once.
  - A search costs an elemental and a catalytic point (Wiki); with no points, 25 pearls buy
    the search instead. The points are spent first.
  - A search is rolled first and given only if the whole roll fits. Otherwise the inventory-full
    message shows and the points stay.
- **Loot** (Wiki; `server/plugins/minigames/data/guardians-of-the-rift-rewards.json`):
  - The main table out of 140: pouches, runes, talismans, pearls, the intricate pouch, ashes and
    the needle. Its 14-16 pearls credit the saved pearl balance rather than the inventory.
  - The rare table rolls apart: Atlax's diary (once), the catalytic talisman, the abyssal needle
    (once), the lantern and the dyes. The Abyssal protector is 1/4,000, through the pets plugin.
  - The pouch is the next one the player lacks, else the table rolls again.
  - The law and death talismans need their quests.
  - Runes past the player's level come at a third (ours; the Wiki doesn't give the reduction).
  - New pouches don't come prefilled with pure essence yet.
- **Intricate pouch** (Wiki): Open needs two free slots ("You need at least two free inventory
  spaces to open this pouch."). Pre-roll, main and hard-clue tertiary tables. Objectbox "You open
  the intricate pouch and find something inside!" (Leagues capture).
- **A needle on the Rewards Guardian** makes an abyssal needle (Wiki). The abyssal needle on a
  pouch stitches the four into a colossal pouch (see Essence pouches).
- **Apprentice Felix:**
  - Trade, and his transcript's shop, open the Omnishop at `gotr_reward_shop_all` (row 7142,
    captured for an account with every quest). The other rows (`_none`, `_law`, `_death`,
    `_blood`, `_law_death`, `_law_blood`, `_death_blood`) follow Troll Stronghold, Mourning's End
    Part II and Sins of the Father.
  - Felix's binding to the old Temple Supplies shop in shops.json is removed. The Temple of the
    Eye quest copies keep it.
  - A dye on Felix plays his transcript ("You show the abyssal red dye to Felix.", Leagues
    capture) and swaps it. Selling dyes and lanterns isn't built.
- **Apprentice Cordelia** (her transcript; the opening line is captured):
  - 25 pearls unlock the repairs (`gotr_cordelia_repair_pouch`, which gives her the Repair
    option). Each repair then costs 1 pearl and repairs every decayed pouch. Both take the
    saved balance: a refused purchase leaves it untouched.
  - The Repair option's chat lines are ours.
- **Chatter:** Tamara and Cordelia say the captured lines during a game, every 25-50 ticks (ours).
- **Not built:** the abyssal lantern's effects ("Your lantern gets you a bonus rune."),
  combination runes and polyelemental stones, and Tamara's barrier lock (themed worlds only).

## Existing code it touches

- **Temple of the Eye (`plugins/quests/quests/TempleOfTheEye.Quest.js`)** runs its scenes on the
  temple's two template squares, not here: the untouched temple at 2368-2431,5632-5695 and the
  tutorial's at 2432-2495,5696-5759 (Quest Helper's tiles and capture 1693's cameras). Its
  handlers step aside for anyone who has finished the quest, so they can run before the
  minigame's: GotR loads after Shopkeepers (`dependsOn`, for the pearl currency), so after the
  quests and skills too. A relog during the tutorial keeps its items (`Temple.login` only strips finished
  players).
- **Runecrafting (`plugins/skills/Runecrafting.plugin.js`):**
  - The essence pouches move to `runecrafting/Pouches.Runecrafting.js`.
  - It answers "runecrafting:altar-rune" so GotR crafts with its rune data.
  - Its XP table follows the Wiki.
  - GotR's altar, exit-portal and pouch handlers only claim players in a game. The altar and
    exit portal are Runecrafting's own locs, so GotR claims them in `onBeforeObjectInteraction`
    for a player on an altar trip; without guardian essence the click falls through to plain
    Runecraft.
- **Data:** the Great Guardian and the apprentices in `npc-spawns.json`, the fighters in
  `npc-combat-defs.json`, and Felix's old shop binding dropped from `shops.json`.
- **`plugins/interface/data/minigame-teleports.json`** already lists Guardians of the Rift
  (3615,9477).

## Phases (all built, one commit each)

1. Lobby, barrier and the game loop: the temple Area, one world-wide game, power and the HUD,
   Power-up, the end-of-game points and XP.
2. Essence: mining and the 250 cap, the workbench, the huge-remains portals and the rubble, the
   Deposit Pool, essence pouches (with guardian essence and the colossal pouch).
3. Portal Guardians: altar rotation, Enter with the overlay, crafting guardian essence into
   runes, stones and charged cells, portal talismans.
4. Cells, barriers and rift guardians.
5. Abyssal creatures and the fight.
6. Rewards: the Rewards Guardian and its tables, the intricate pouch, Felix, Cordelia, the abyssal
   needle.

# Last Man Standing

Last Man Standing in the Ferox Enclave, all three modes (Casual, Competitive, High Stakes): Lisa,
the supply chest, the waiting areas, both island arenas, the fog, keys, chests and crates, rank and
points, High Stakes fees and winnings, Justine's shop, the scoreboard and the coffer. The plugin is `server/plugins/minigames/LastManStanding.plugin.js` with its units
in `server/plugins/minigames/lms/`, and its data in
`server/plugins/minigames/data/last-man-standing.json`.

## Sources

- **rsprox recording, rev 241, 26 October 2026, world 559 (LMS Competitive):** Lisa's
  introduction, the supply chest, the coffer, Justine's shop and a purchase, the scoreboard, and
  eight competitive games (1 Def Pure, Zerker, Max/Med on both islands): seven deaths and a win.
- **OSRS Wiki** ([Last Man Standing](https://oldschool.runescape.wiki/w/Last_Man_Standing) and its
  loot table, key, crate and shop pages): the builds' levels, loot tables, points and rank rules,
  supply limits, the fog's damage beyond what was recorded, shop set sizes.
- Everything marked *inferred* below is neither.

## Lobby

| What | Captured |
| --- | --- |
| Lisa (`br_host`, multinpc on varbit `br_tutorial`) | "Welcome, are you looking to take part in a game of Last Man Standing?"; before the introduction: Tell me more. / Not right now.; after it: I'd like to play. / Tell me more. / Not right now. |
| Introduction | Nine pages, ending "Now that you know more, ...": varbit `br_tutorial` 1 and varp `br_rank` 500 on that line |
| I'd like to play. | "Which mode would you like to play?": `<str>High Stakes (500,000 coins)</str>` / Competitive (free entry) / Casual / Cancel; Competitive moves the player into its waiting area, varbit `br_mode_selected` 1, and the load-out varbits are sent |
| Competitive barrier (`br_competitive_entrance`) | In from (x, 3639) to (x, 3640); out: "Forfeit - Are you sure?" Yes. / No. to (x, 3638); before the introduction a messagebox: "You haven't completed the Last Man Standing introduction, please talk to Lisa before entering a game." |
| Lobby overlay `br_lobbyoverlay` (333) on overlay_hud | Rank "Novice (500)", coffer "Empty"/"500K", "(13/24)" per mode, refreshed every 5 ticks; the mode the player waits for recoloured 992, others 32767 |
| Game start | As the last player a mode needs arrives |
| Wizard (`br_wizard_competitive`) | "Come on, we need 5 more competitive participants!" |
| Settings (`br_settings`, 476) | Opened from the overlay's settings button; `br_settings:stats` sub 0-2 sets varbit `br_preferred_build` |
| Supply chest (`br_loadout_customiser`, 646) | See below |
| Scoreboard (`br_scoreboard`, 395 in the chatbox) | "Wins: 1", "Kills: 5", "Games played: 8" |
| Reward chest | "You have nothing to claim." |
| Coffer | "The coffer is empty. You need at least 1,000 coins to make a deposit." (no coins) / "The coffer is empty." then "Coffer (Empty)": Deposit money. / Cancel.; "How much do you wish to deposit? (500,000)"; varbit `br_coffer` in thousands; "Coffer (500,000 coins)": Withdraw money. / Cancel.; "How much do you wish to withdraw? (500,000 coins)" |

## Modes

| Mode | Waiting area | Players | Rewards |
| --- | --- | --- | --- |
| Casual | First floor, barrier `br_casual_entrance` at y 3638 | 4 (Wiki) | None (Wiki) |
| Competitive | Ground floor, barrier at y 3639 (captured) | 24 | Rank and points |
| High Stakes | Second floor, barrier `br_highstake_entrance` at y 3639 | 24 | Rank and points; 7,500,000 and 2,500,000 to the reward chest for 1st and 2nd, a free next game for 3rd-5th (Wiki) |

- Each mode has its own wizard calling for players ("Come on, we need 24 more High Stakes
  participants!" captured; the casual line is inferred).
- Wiki entry rules for Competitive and High Stakes: a total level of 750 and 30 quest points, or
  1,500; Competitive only on members' worlds; no High Stakes for Ironmen; three forfeits in a day
  (logging out or a Desert Island rowboat, `br_boat_forfeit`) bar both for the rest of the day.
- High Stakes costs 500,000 from the coffer, taken as the game starts (a free entry first). It
  runs only with world config `LastManStanding:highStakes` (the captured world showed it struck
  through in Lisa's menu, as it is with the config off).
- *Inferred:* the refusal lines (requirements, members, Ironmen, the fee, forfeits, High Stakes
  closed), the reward chest's claim and prize lines, the rowboat's question (the barrier's), and the
  upstairs waiting areas' extent.

Everyone waits empty-handed: entering a waiting area stashes the player's things (as a game does),
and leaving it through the barrier gives them back, as does the end of their game. Varbit
`holding_inventory_location` is 2 while they are held and 0 once they are back. A teleport cast in a
waiting area is refused with "Please use the door if you need to leave." (captured); anyone who
leaves some other way (a staff teleport) gets them back on their next login. Bots wait the same way,
standing still with no brain until their game starts (the PvP brain would wander to the Wilderness and re-gear an empty bot).

## Load-outs

The supply chest's three columns are drawn by the client from varbits `br_loadout_{a,b,c}_*`
(a Max/Med, b Zerker, c 1 Def Pure). Each slot holds an index into its build's enum (4629, 4630,
4631); enums 4633-4635 map a worn slot to its component. The spellbook value goes through enum
4389 (0 Ancient, 1 Standard, 2 Lunar), and the menu's sub is the value + 1.

Captured answers: a drag between inventory slots swaps them; a drag onto the trash, or a click,
empties the slot (sound 2381); a click in the list adds the item to the first free slot.
*Inferred:* a drag between the inventory and a worn slot wears or removes an item that fits that
slot. Wiki: at most 10 sharks, 3 Saradomin brews, 2 Sanfew serums and 1 of each other potion; no
Lunar spellbook for a 1 Def Pure. *Inferred:* 2 karambwans (the default) and one of each piece of
gear.

The defaults are the values Lisa sends on a first game.

## A game

| From the start | Captured |
| --- | --- |
| Arrival | A copy of the island, chunks as captured: Desert Island 16x16 from (3392, 5760), Wild Varrock 24x24 from (3456, 6016), planes 0-2. "Last Man Standing mode: <col=ef1020>1 Def Pure</col>", music 474, `pvp_icons` with `pvp_area_client` 1, `br_overlay` (328) on overlay_atmosphere, player option "Fight". Varbits `br_ingame` 1, `br_active_map_player` (1 Desert Island, 2 Wild Varrock), `br_active_build_player` (0 Max/Med, 1 Zerker, 2 1 Def Pure). Levels set with no experience |
| Countdown | Every player says "12..." to "1..." two ticks apart, then "GO!" and "The fight for survival has begun!"; nobody can move until then (a click only gets "I can't reach that!"); attacking earlier: "The game has not started yet!" (spam) |
| Overlay | "24 / 24" survivors, kills ("Safe" before the start), fog status, every tick; `br_timedisplay` 1 at the start, +1 every 50 ticks |
| +100 | "Lethal fog will soon fill the island! The safezone is <col=ef1020>the Mountain</col>." (broadcast), a 13x13 square of `br_safezone_indicator` locs and a hint arrow: on the centre within 58 tiles, else 30 tiles from the player straight along the axis the centre is furthest on (seen at 75 and 90), moving with them. *Inferred:* the switch at 64 |
| +250 | "Approaching" (in the fog or not); `br_safecoord_x`/`br_safecoord_z` (instance coordinates) and `br_saferadius` 100, falling by one every 4 then 6 ticks |
| +300, then every 200 | "A magical loot crate has appeared near the Trading Post!"; `br_lootcrate_spawning` for 5 ticks, then `br_lootcrate` (Search) |
| +625 | "Danger"; the radius drops to 16, then falls to 6 |
| In the fog | `br_fog_damagecount` +1 every 2 ticks to 6; hits 1, 1, 1, 1, 2, 2, 3...; out of it the count falls 6 -> 3 -> 0 |
| A kill | A bloody key in the killer's inventory, special bar full, health full, `br_killcount` +1, all on the kill's tick; the victim's ammunition, what they picked up and their bones on the ground, owned by the killer for 100 ticks, gone at 200 (a 1 Def Pure left only its bolts; a Max/Med whose load-out had changed left a whip, a defender and a robe top) |
| A chest (Open / Search) | With a key: the chest shows `br_loot_chest_looted_open` as they reach it (and closes 100 ticks later); a tick later "You find some loot: <col=ef1020>Volatile Nightmare staff</col>", the second roll's line and animation 832; without one: "You require a key to claim the loot." |
| A crate (Search) | The loot line, animation 832, and the crate is gone, on one tick |
| A death | 4 ticks after the death animation, as the player reaches the lobby: "Good effort!" (top 9) or "You must make a more valiant effort for a reward.", "Oh dear, you are dead!", varp `br_rank`, song 147 and jingle 90, the lobby; the lobby's song a tick later; "Your rank has increased!"/"decreased!" a tick later, then the points a tick after that |
| The win | "You are victorious!", varp `br_rank`, the lobby and its song; "Your rank has increased!" two ticks later, then "You have earned <col=ef1020>6 points</col>. Total: <col=ef1020>13</col>." |

Wiki rules on top: single combat; 20 seconds unattackable after a kill; health, run energy,
special and supplies refilled after a kill; a bloodier key with five or fewer left; a bloody key
rolls the offensive and defensive tables, a bloodier key and a crate the upgraded one; 16+ tiles
into the fog up to 10 damage every other tick; outside the zone once it's "Danger", 1 a tick rising
to 10; unlimited prayer and run energy; Rapid Restore, Rapid Heal, Protect Item, Retribution,
Redemption, Smite and Preserve disabled ("<col=000080>Redemption</col> is currently disabled
here." captured); a 20 minute game; logging out forfeits and the attacker gets the kill; no
experience. Points by place for a player with a kill (6, 5, 4 for 3rd-4th, 3 for 5th-9th, 1 for
10th-19th), plus 2 for 3 kills or 3 for 5; rank +10-place for 1st-9th, -(place-16) for 17th-24th.

*Inferred:* players start beside the island's chests, spread out; crates land within 10 tiles of a
chest on Desert Island and of the safe zone on Wild Varrock (Wiki: anywhere, and close to the safe
zone); the fog's edge is square (the markers are); no points for dying within a minute of the
start (captured at 48 ticks, the threshold isn't known); the ammo stacks from chests are 100.

The player's own inventory, equipment, combat levels, spellbook, special and run energy are saved
in `last-man-standing:stash` on arrival and restored on leaving. A save made mid-game (a crash or a
restart) is restored on the next login, and the player is put in the lobby.

## The game's items

The game's items are copies of real ones (`br_` items, and `fake_dragon_arrow`) with their own ids
but the same name, model, slot and category. At startup each is registered as an alias of the real
item (core `ItemAliases`), so the special attacks, ranged weapons, ammunition and weapon profiles
keyed to the real item work with the copy. The potions ("Saradomin brew(4)" to "(1)") are
registered with the Potions plugin (`potions:register-copy`) as copies of the potion of that name,
each dose leading to the game's next and the last to its own vial (`br_vial_empty`). The rune pouch (`br_rune_replacement`) covers every rune
a spell needs while its holder is in a game (Wiki: it "gives access to" the load-out's spells;
*inferred:* it never runs out). Effects that plugins check by a real item's id (a ring's or staff's
passive) don't see the copies yet.

## Justine's shop

Justine's Trade opens `br_reward_shop` (645) in place of the generic shop 1449 bound to her in
`shops.json`. Captured: the stock arrives as inventory 422, each slot's count its price; points on
varp 261 and wins on varp 262; the confirm button's sub is the slot; set rewards ask "How many sets
of 50 would you like? (0 - 13)"; a purchase takes the points, adds the items, plays sound 2304 and
reopens the shop. With no win Justine first explains that browsing is allowed, but buying
tradeable rewards requires a win. This clarifies the recorded line, which misleadingly starts
"Before I show you the rewards". Points are the existing
`shop-currency:Last Man Standing Points`. Wiki: tradeable rewards need a win.

## Bots

PvP bots fill a mode's waiting area while a real player waits for it (world config
`LastManStanding:seedBots`, on by default). In the arena they fight on the PlayerBots PvP brain,
pick the nearest free survivor, walk back into the safe zone when the fog has them, spend a key at
once on its loot (and wear what fits), and never retreat. They log out when their game is over, and
a game with only bots left ends. `LastManStanding:minPlayers` lowers the 24 (and Casual's 4) for
small worlds.

## Not done yet

- The Trinity Outpost safe zone: it was broadcast in one game, but its markers were never in view,
  so its centre is unknown. Desert Island uses the Mountain only.
- Captured responses not reproduced exactly: the arrival's full sidebar refresh, and the moment the
  death lines arrive (the core's death task runs on its own timing; the lines come as the player
  reaches the lobby, as captured, but that may be a tick or two off the capture's four ticks).

## The fog on screen

Cache scripts draw it: `pvp_icons_layout` (386) shows `br_overlay:1`, a full-screen rectangle, sets
its fill mode to a top-down alpha gradient (`if_setfillmode`, 2125) and runs 1346 on a timer, which
tints it by the player's distance from `br_safecoord_x/z` against `br_saferadius` (clear within
radius - 8, full past radius + 8; Desert Island dark red, Wild Varrock orange, or the fog colour
setting). Client changes: `IF_SETTRANSBOT` (2124) and `IF_SETFILLMODE` (2125), which the client
lacked (the script stopped there and left a bare rectangle on screen), and screen effects mounted on
`overlay_atmosphere` no longer take the mouse wheel from the camera.

## Core changes

- `onPlayerBeforeDeath` events carry `announce` (default true): a plugin sets it false to send
  "Oh dear, you are dead!" itself, as Last Man Standing does to put its verdict first.
- `onPrayerDisabled` events can set `messageBox` to show the refusal in a messagebox, as live does
  for "<col=000080>Redemption</col> is currently disabled here."; `emitPrayerDisabled` returns the
  message and how to show it.
- `ChatType.BROADCAST` (14), the chat type of the fog and crate announcements.
- Potions plugin: `potions:register-copy` `{ name, chain, emptyItemId }` registers another
  plugin's own dose chain as a copy of a potion.
- `ItemAliases`: an item that stands in for another in the id-keyed weapon tables (special attacks,
  ranged weapons, ammunition, weapon profiles, and the ammunition check), on `api.core`.
- Combat: a player's melee hit on a player no longer takes a fixed extra tick; as for magic and
  ranged, PID decides (Wiki, Hit delay: "In the case of PvP, PID will be the determining factor").
  Of two players attacking on the same tick, the one processed first lands that tick, the other
  the next. Hits on NPCs keep their tick (NPCs are processed first).
- Animations: of two set on one tick at the same server priority, the one with the lower cache
  interrupt priority (sequence opcode 5) no longer replaces the other, as the client already does
  for one that is playing: a block (5) landing on the tick of a swing (6) kept the client from
  ever seeing the swing.
- Combat: while content keeps a fighter walking between hits (`preserveMovementForTicks`, the PvP
  bots' steps), they face where they walk, as a player who clicks a tile does, and turn back to the
  target when the step ends (unless `combat:keep-facing` holds their facing).

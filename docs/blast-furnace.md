# Blast Furnace

The dwarven furnace under Keldagrim (`server/plugins/minigames/BlastFurnace.plugin.js`). Behaviour is from the OSRS Wiki and the dwarves' Wiki transcripts. Where they say nothing, it follows Offline_Scape's port (Zenyte lineage, no licence); every fact taken only from there is marked **(RSPS)** below so it can be checked against live.

## How it works

- **Getting there:** the stairs in Keldagrim (loc 9084 at 2930, 10196) go down to 1939, 4958, and the stairs in the furnace (9138) go back up to 2931, 10196 **(RSPS: tiles)**.
- **The coffer** (loc 29330, a multiloc on varbit 5356 that is set while it holds coins) has Use: deposit or withdraw coins.
  - The dwarves charge 72,000 coins an hour, "deducted as long as you're in this room with us" (Dumpy's transcript), so 12 coins a tick.
  - The HUD is interface 474 in the overlay slot (161:8). Its script reads varbit 5357 for the amount.
- **The foreman** lets smiths under 60 Smithing use the furnace for 2,500 coins for ten minutes. This runs through his transcript, both Talk-to and the Pay option: the plugin answers its coin, Smithing and Ring of Charos(a) conditions, and takes the fee on the "Okay, you can use the furnace for ten minutes." line. With the ring, the haggle costs 1,250. The chromium-ingot option is hidden because that content isn't in this server.
- **The conveyor belt:** Put-ore-on loads every suitable ore you carry, and using one ore on the belt loads just that ore. It needs coins in the coffer, and the foreman's permit under level 60.
  - Each ore needs the level of the bar it makes (coal needs 30, for steel).
  - The pot holds 28 primary ores (counted together), and 254 each of coal and tin. Pending conveyor loads count towards those limits; excess stays in the inventory. These capacities are documented on the [Blast Furnace page](https://oldschool.runescape.wiki/w/Blast_Furnace).
  - A full stack of 28 bars of any metal blocks further belt loading, including coal. The bars must be collected first; the refused load stays carried.
  - Pending ore is saved separately from the melting pot. Pot counters update when the load arrives. Logging out with only coal on the belt loses that pending coal, while coal already in the pot remains. Mixed pending loads survive logout and resume on return, rather than becoming pot contents immediately ([Wiki](https://oldschool.runescape.wiki/w/Blast_Furnace)).
  - Each ore type rides the belt as its own NPC (2924-2932), one tile a tick for 3 tiles, then falls into the pot (animation 2434) **(RSPS: timing)**.
- **Smelting** happens when the belt is empty. It uses half the coal of a furnace (Wiki), and iron always succeeds.
  - Bars that need coal are made first, so iron with coal in the pot becomes steel, and any iron left over becomes iron bars.
  - Ore waits in the pot until there's enough coal for it.
  - The dispenser holds 28 of each bar ([Bar dispenser](https://oldschool.runescape.wiki/w/Bar_dispenser)). Ore it has no room for stays in the pot and is smelted once bars are taken.
  - XP is given as the bars are made. Gold gives 56.2 XP with goldsmith gauntlets or a Smithing cape.
  - The pot's ore and the dispenser's bars are sent as varbits 941-959 (RuneLite `BLAST_FURNACE_*`). Melting Pot and Bar dispenser "Check" list them.
- **The bar dispenser** is loc 9092, a multiloc on varbit 936: 0 empty, 1 pouring, 2 hot, 3 cooled. It pours for 2 ticks, then the bars stay molten for 16 ticks before they cool **(RSPS: timings)**.
  - Molten bars need ice gloves or smiths gloves (i), or a bucket of water thrown on them (animation 2450).
  - Take opens the skillmulti "How many would you like to take?" menu, using take mode 17 and an available-quantity limit, and gives as many as fit in the free inventory slots, with a message box "You take 23 mithril bars from the dispenser."
- **Also:**
  - The sink fills a bucket of water (`human_pickuptable`, sound 2609, "You fill the bucket from the sink.").
  - The temperature gauge opens interface 30.
  - The machinery's looping animations (belt 2435, cogs 2436) are sent when you enter.
  - The anvil gate (9141) needs 60 Smithing; below that, Jorzik's transcript line plays instead.
  - The coffer, ore, bars and permit are saved on the `blast-furnace` attribute.

## Manual and dwarf-operated worlds

The existing world-zone tag mechanism selects the mode. The shipped global zone includes
`blast-furnace`, preserving dwarf operation for existing default deployments. Untagged worlds
operate manually. A `world.local.json` override that replaces `zones` must include the tag on
an unbounded zone to keep dwarf operation; use an untagged global zone to test manual work.
Only dwarf worlds require/deduct the coffer fee. Both retain the foreman's unboostable
base-60 exemption and under-60 permit. The furnace Area blocks PvP, including on PvP worlds.

`blastfurnace/Machinery.BlastFurnace.js` owns shared fuel, temperature and broken machinery:

- Level 30 Agility pedals move every player's loaded ore, use 0.5 run energy and give 1 XP
  per tick. Level 30 Strength pumping gives 2 XP per tick with fuel, even when pipes are broken.
- A level 30 Firemaker collects coke with a spade, then refuels the stove for 5 XP and gets
  the spade back. The stove changes between its three cache forms as fuel changes.
- Bars smelt only with fuel, intact machinery and sufficient heat. Overheating breaks the
  machinery and stops operators without damaging them (10 November 2021 update).
- A hammer and level 30 Crafting repair a broken drive belt, cogs or either pipe for 50 XP.
- The temperature gauge receives cache varbits 937–939. Recent operators, stokers, repairers
  and gauge readers receive contribution XP. The specific [Bar dispenser page](https://oldschool.runescape.wiki/w/Bar_dispenser)
  quotes Mod Ash's 1.5 XP per pour, including the owner, with a ten-tick cooldown; this is used
  over the general Blast Furnace page's older 1 XP-per-bar table.
- Operator tasks stop on movement, transformation, death, logout, exhaustion or shutdown;
  pumping is capped at the documented 100 minutes. Dwarves are absent from manual worlds;
  Stumpy and Pumpy use their cache machinery idle sequences on dwarf worlds.

Coal bags keep the OSRS two-click workflow: empty the bag through the existing StorageItems
action, then put its inventory coal on the belt. Put-ore-on never automatically empties the
bag. Coal exceeding the pot's capacity remains in the inventory. This path is regression-tested
against the real shared storage transfer; no new container store or automatic unloading is added.
Lead and cupronickel use shared Smithing recipes (two lead ore; two copper and one nickel).
Nickel is capped at 14, within the shared 28-primary-ore limit. Checking the pot offers contents or confirmed
destruction of owned ore, including pending conveyor NPCs, without deleting another player's
ore or any completed bars. Recipe definitions live in `plugins/skills/data/smithing.json`;
the two members recipes are hidden/refused on F2P worlds.

Pouring bars cannot be collected, and Take rechecks cooling when the menu callback runs.
Water cools all other players' hot bars within five tiles, including Ironmen, as the
Bar dispenser page's Mod Ash reference describes. The dispenser cap remains 28 per metal.

## Remaining source limits

- The manual heat scale/threshold (40 of 100), fuel decay (one load per 50 ticks), maximum
  fuel (30), break chance (1/500 active ticks), and recent-contribution window (100 ticks) are
  explicit estimates. The sources describe the mechanism but not those values; replace them
  when a live fighter/operator capture establishes the timings. They are not verified parity.
- Original belt/dispenser timings and room travel tiles labelled **RSPS** above remain
  unverified against a live capture.
- Dwarf-operated captures 3278 and 1757 show Dumpy's nine-tick cycle: shovel-up with a
  15-client-cycle delay at tick 0, carried-coke form at tick 1, shovel-down with delay 15 at
  tick 2, and shovel-finish plus empty form at tick 4. The plugin reproduces this cycle.
  Captures also show Thumpy's `human_smithing` and Numpty's `emote_dance_headbang`, but their
  variable repair triggers/cadence remain unknown; no invented continuous idle loop is used.
- New manual refusals, empty-pot prompts and lead/cupronickel messages use unverified wording,
  labelled in code/data until a matching capture establishes the text.

## Verification

The Blast Furnace, Smithing and storage-item regression tests check paid and manual operation, fuel/pedals/heat gating, manual XP/cancellation, shared
contribution cooldown, overheating/repairs, room scoping, coal-bag capacity, lead/cupronickel,
confirmed pot emptying, stale-menu cooling checks, nearby shared cooling and F2P recipe gates.
Review regressions also cover pending conveyor ore through Take/re-entry, helper-only cooling,
integer-valued pedal energy across restarts, nickel limits and the captured Dumpy cycle.

## Conveyor and dispenser parity evidence

The [Blast Furnace page](https://oldschool.runescape.wiki/w/Blast_Furnace) documents the
collect-bars refusal, primary/secondary ore limits, and coal-only versus mixed-load logout
behaviour. The specific [Bar dispenser page](https://oldschool.runescape.wiki/w/Bar_dispenser)
confirms a separate 28-bar capacity for each metal; it resolves the general page's less
specific wording about bar capacity.

Rsprox captures establish the following additional facts:

- Recording **1757** has 28 runite bars, 16 runite ore and 20 coal in the furnace when a new
  coal load is refused with “You should collect your bars before making any more.” The
  refused load is not removed. Earlier successful coal loads update the pot's coal count
  after inventory removal, followed by smelting.
- Recording **3278** also shows the collect-bars refusal, the empty-belt message
  “You don't have anything suitable for putting into the blast furnace.”, and the
  noted-mithril-ore refusal “There would be no point in smelting that.”
- Recordings **96**, **1757** and **3278** show the take quantity menu with mode 17 and
  the title “How many would you like to take?”. A five-bar runite example offers five.
  Empty-dispenser responses say “The dispenser doesn't contain any bars.” Recording **3278**
  shows the take itself: “You take 23 mithril bars from the dispenser.” in a message box (the Wiki
  changelog: “A message displaying the numbers of bars withdrawn now appears”).
- “All your ore goes onto the conveyor belt.”, “You throw the water over the bars.” and
  “You fill the bucket from the sink.” are spam-channel lines (recordings 96, 1757, 3278); the
  sink also plays `human_pickuptable` and sound 2609. The coffer's menu is titled
  “Select an option” (recordings 96, 3278).
- Recording **3278** shows water cooling on the same response tick: the throw animation,
  sound 1051, “You throw the water over the bars.”, one water bucket exchanged for an empty
  bucket, and hot state 2 becoming cooled state 3. Sound 1051 exists in the active cache.

These recordings are from Leagues V or Grid Master. They support the listed interaction
responses and ordering; their XP multipliers and automatic noting are not normal-world
behaviour. Exact normal-world conveyor travel time remains unverified, as do the manual
machinery estimates listed above. This change retains the existing travel duration.

Regressions cover full-dispenser refusal and collection recovery, pending-load capacity,
delayed pot counters, coal-only logout loss, mixed-load persistence and resumption without
duplication, the empty/refusal messages, take-menu parameters and water-cooling feedback.

## Smithing catalyst

A carried Smithing catalyst is consumed for each coal bar produced and doubles that bar's
Smithing XP. Blast Furnace's existing reduced coal requirement is unchanged. If fewer catalysts
are carried than coal bars are made, the server applies them in its existing recipe order; this
allocation order and the precise retail inventory/belt reservation lifecycle are not established
by the source. Non-coal bars do not consume catalysts. See the [Smithing catalyst](https://oldschool.runescape.wiki/w/Smithing_catalyst)
and [Giants' Foundry update](https://oldschool.runescape.wiki/w/Update:Giants%27_Foundry).

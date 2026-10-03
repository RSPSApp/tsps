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
  - The pot holds 28 ore that makes bars (copper, iron, silver, gold, mithril, adamantite and runite, all counted together), and 254 each of coal and tin **(RSPS)**. Ore over the limit stays in the inventory.
  - Each ore type rides the belt as its own NPC (2924-2932), one tile a tick for 3 tiles, then falls into the pot (animation 2434) **(RSPS: timing)**.
- **Smelting** happens when the belt is empty. It uses half the coal of a furnace (Wiki), and iron always succeeds.
  - Bars that need coal are made first, so iron with coal in the pot becomes steel, and any iron left over becomes iron bars.
  - Ore waits in the pot until there's enough coal for it.
  - The dispenser holds 28 of each bar **(RSPS)**. Ore it has no room for stays in the pot and is smelted once bars are taken.
  - XP is given as the bars are made. Gold gives 56.2 XP with goldsmith gauntlets or a Smithing cape.
  - The pot's ore and the dispenser's bars are sent as varbits 941-959 (RuneLite `BLAST_FURNACE_*`). Melting Pot and Bar dispenser "Check" list them.
- **The bar dispenser** is loc 9092, a multiloc on varbit 936: 0 empty, 1 pouring, 2 hot, 3 cooled. It pours for 2 ticks, then the bars stay molten for 16 ticks before they cool **(RSPS: timings)**.
  - Molten bars need ice gloves or smiths gloves (i), or a bucket of water thrown on them (animation 2450).
  - Take opens the skillmulti "What would you like to take?" menu, and gives as many as fit in the free inventory slots.
- **Also:**
  - The sink fills a bucket of water.
  - The temperature gauge opens interface 30.
  - The machinery's looping animations (belt 2435, cogs 2436) are sent when you enter.
  - The anvil gate (9141) needs 60 Smithing; below that, Jorzik's transcript line plays instead.
  - The coffer, ore, bars and permit are saved on the `blast-furnace` attribute.

## Not done

- **Working the furnace yourself:** the stove, pump, pedals, broken pipes and the temperature, all of which the dwarves now do.
- **Dumpy and Numpty's idle animations.**
- **Coal bag emptying onto the belt.** There's no coal bag in this server yet.

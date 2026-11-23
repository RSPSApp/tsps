# Karuulm Slayer Dungeon: extreme heat

`server/plugins/areas/KaruulmSlayerDungeon.plugin.js`, tested by
`server/tests/karuulm-extreme-heat.test.cjs`.

## Behaviour

OSRS Wiki, [Extreme heat](https://oldschool.runescape.wiki/w/Extreme_heat),
[Karuulm Slayer Dungeon](https://oldschool.runescape.wiki/w/Karuulm_Slayer_Dungeon) and
[Mount Karuulm](https://oldschool.runescape.wiki/w/Mount_Karuulm):

- Beyond the entrance chamber, where the three Tasakaal stand, the floor burns the player for
  **4 damage every tick**, which can kill.
- [Boots of stone](https://oldschool.runescape.wiki/w/Boots_of_stone),
  [Boots of Brimstone](https://oldschool.runescape.wiki/w/Boots_of_Brimstone) or
  [granite boots](https://oldschool.runescape.wiki/w/Granite_boots) keep it off.
- Players who have obtained the elite [Kourend & Kebos Diary](https://oldschool.runescape.wiki/w/Kourend_%26_Kebos_Diary)
  rewards take no heat damage with any footwear, or none. The plugin asks
  `diary:is-reward-claimed` for `kourend` / `elite`, so completing the tasks without claiming the
  reward from Elise does not protect.

## Where it burns

The area is every level (0-2) of x 1230-1355, y 10130-10290. The heat is skipped only in the
entrance chamber: level 0, x 1303-1320, y 10185-10214. That is the cache map's walkable room
around the elevator landing (1311,10188, `karuulm_elevator_down` in
`server/plugins/world/data/loc-teleports.json`), found by flood fill over the collision map. It
is closed off by the three `karuulm_safe_stepover` "Rocks" (loc 34544) at 1321,10205 (east),
1302,10205 (west) and 1311,10215 (north), crossed as Agility shortcuts
(`server/plugins/skills/data/agility-shortcuts.json`). rsprox captures 3013, 3014 and local
1000143 show players climbing the east and north rocks to 1322,10205 and 1312,10216.

The Alchemical Hydra's chamber (east of x 1355) is a private area of its own
(`plugins/bosses/alchemicalhydra/Lair.AlchemicalHydra.js`), so it does not burn.

## Not covered

- The Wiki says players are warned when they try to leave the chamber without protective boots.
  Neither the Wiki nor any recording we have gives the wording (the recordings' players all wore
  boots), so no warning is sent.

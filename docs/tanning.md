# Tanning

`server/plugins/npcs/Tanning.plugin.js` drives the native tanner interface (group 324,
`tanner`) for every tanner: Ellis (Al Kharid), the Crafting Guild's Tanner, Sbott (Canifis),
Eodan, and Mary after Getting Ahead (through the `tanning:open` event). Rows, products and
prices are in `server/plugins/npcs/data/tanning.json`. Eodan charges 10 times the normal price,
falling to 8, 6, 4 and 2 times with each Kourend & Kebos Diary tier
([Eodan](https://oldschool.runescape.wiki/w/Eodan)).

## Free-to-play

Ellis and the Crafting Guild tanner are free-to-play; the Leatherworker, Sbott, Eodan, Mary and
Chouani are members-only ([Tanning](https://oldschool.runescape.wiki/w/Tanning),
[Ellis](https://oldschool.runescape.wiki/w/Ellis)). The plugin is therefore not marked
`members`: on a free world the members tanners are out of reach because they stand in members
areas, or need a members quest.

## After a tan

From rsprox captures 90, 91, 1104, 1846, 1857, 1858, 1862, 3276 and 3333. All of them are Leagues
or event worlds, the only ones that recorded the tanner, and none shows a coins change in the
inventory, so prices come from the Wiki:

- A button that tans anything closes the interface and sends one message, both on the tick the
  hides change (the click tick or the next):
  `The tanner tans your cowhide.` for a single hide, `The tanner tans # cowhides for you.` for
  more (`# green dragonhides`, `# blue dragonhides`, `# red dragonhides`, `# black dragonhides`
  likewise). Soft and hard leather both name the cowhide.
- No capture tans snake hide, so the snakeskin rows send no message yet.

## Not covered

- Coin shortfalls (partial tans, the "not enough coins" text) have no main-game capture.
- Whether a free world refuses members hides at Ellis is not documented; dragonhides and snake
  hides are tanned as on a members world.
- The Leatherworker and Chouani are not implemented.

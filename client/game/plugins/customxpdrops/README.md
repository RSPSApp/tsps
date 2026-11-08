# Customizable XP drops

A port of l2-'s Plugin Hub plugin [Customizable XP drops](https://github.com/l2-/template-plugin)
(BSD 2-Clause, the hub's commit `3835071`). Turn it on in the plugin list; it is off on fresh
installs.

The client draws its own XP drops in place of the game's: a box in the top right (Alt-drag moves
it), or over your character or the target you hit. Grouped or one per skill, their speed,
direction, lifetime, fade, icons, colours (one per offensive prayer style), font, background,
prefix and suffix are all settings, and skills can be filtered out. The game's drops and XP
tracker are hidden while it is on (Miscellaneous), and the orb's Show/Hide XP drops toggle still
hides these. An optional XP tracker shows the most recent (or a chosen) skill's XP, with a
progress bar to its goal.

## Predicted hit

A Hitpoints drop says what you hit before the hitsplat lands: Hitpoints pays 4/3 XP per damage,
so the hit is 3/4 of the gain. This server pays XP at the world's rate (and a league's on top),
so the server's **Hitpoints XP Rate** plugin (`server/plugins/interface/HitpointsXpRate.plugin.js`)
tells the client that rate and the hit is divided by it. "Xp multiplier" is an extra factor on
top, 1 unless you know better.

An NPC that pays a different share of combat XP needs a line in "Predicted hit xp modifiers",
`npcId:modifier`. Server plugins set it for a few NPCs (`setCombatXpMultiplier`): the Gemstone
Crab's is `0.875`, Count Draynor's `0.025`.

## Differences from the plugin

- No wiki XP bonus table and no raid scaling (CoX, ToB, ToA, Delve, Fortis): this server pays
  every NPC the base 4 XP per damage, so they would make predictions wrong. Nor the PvP
  combat level bonus, which the server doesn't pay either.
- No Party section (no RuneLite party here), no overlay priorities, no icon overrides (no
  resource packs) and no fake XP drops (no FakeXpDrop event).
- It uses the game's own bold font rather than shipping a RuneScape Bold file; they look the same.
- Drops move on the 20 ms client tick (the plugin uses BeforeRender, which the WebGPU renderer
  doesn't post), by the wall clock, so the speeds are the same.

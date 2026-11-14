# Dye mixing

`server/plugins/items/DyeMixing.plugin.js`. Two primary dyes used on each other make a
secondary dye:

| Dyes | Result | Animation (cache seq) | Message |
|---|---|---|---|
| red + yellow | orange dye | `mixing_dyes_red+yellow` (4349) | You mix the two dyes and make an orange one. |
| blue + yellow | green dye | `mixing_dyes_blue+yellow` (4350) | You mix the two dyes and make a green one. |
| red + blue | purple dye | `mixing_dyes_red+blue` (4348) | You mix the two dyes and make a purple one. |

From rsprox captures (orange: 227/00090, local 1000216 tick 511, 1000218 tick 1413,
1000359 tick 8917; green: 232/03198 tick 6731), the same in either order:

- the message is a spam-filtered game message, sent with the animation on the tick of the use;
- the dye that was clicked on (the target) turns into the new dye in its own slot, and the used
  dye's slot empties;
- no Crafting experience.

Purple has no capture. Its recipe is the Wiki's (Purple dye); its animation is the cache's
`mixing_dyes_red+blue`; its message follows the two captured lines (ours).

Goblin Diplomacy used to mix orange dye itself, with its own message; it now only dyes the
goblin mail.

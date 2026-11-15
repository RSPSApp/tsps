# Dye mixing

`server/plugins/items/DyeMixing.plugin.js`. Two primary dyes used on each other make a
secondary dye:

| Dyes | Result | Animation (cache seq) | Message |
|---|---|---|---|
| red + yellow | orange dye | `mixing_dyes_red+yellow` (4349) | You mix the two dyes and make an orange one. |
| blue + yellow | green dye | `mixing_dyes_blue+yellow` (4350) | You mix the two dyes and make a green one. |
| red + blue | purple dye | `mixing_dyes_red+blue` (4348) | You mix the two dyes and make a purple one. |

From rsprox captures (orange: 227/00090 tick 5349, local 1000216 tick 511, 1000218 tick 1413,
1000359 tick 8917; green: 232/03198 tick 6731; purple: 242/900302 tick 749), the same in either
order:

- the message is a spam-filtered game message, sent with the animation on the tick of the use;
- the new dye goes in the lower of the two slots and the higher slot empties, whichever dye was
  used on which (227/00090: slot 7 used on 8, result in 7; 232/03198: 15 on 14, result in 14;
  local orange ones: 8 on 7, 10 on 7, 16 on 14, results in 7, 7, 14);
- no Crafting experience.

Goblin Diplomacy used to mix orange dye itself, with its own message; it now only dyes the
goblin mail.

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
- one dye of each colour is used up from its first slot (by item, not the clicked slot), and the
  new dye goes in the first free slot. 242/900302 shows the difference: at tick 730 red in slot 8
  used on yellow in 16 spends the yellow in 14 (16 stays) and puts orange in 8; at tick 749 blue in
  13 used on red in 9 spends the blue in 11 and the red in 9 and puts purple in the free slot 8.
  227/00090 (7 on 8, result in 7), 232/03198 (15 on 14, result in 14) and the local orange ones
  (8 on 7, 10 on 7, 16 on 14, results in 7, 7, 14) fit the same rule;
- no Crafting experience.

Goblin Diplomacy used to mix orange dye itself, with its own message; it now only dyes the
goblin mail.

# Giant egg sac

Sarachnis's drop (`hosdun_egg_sac_full`, 23517) and the open sac it becomes (`hosdun_egg_sac`,
23520). Plugin: `server/plugins/items/GiantEggSac.plugin.js`. Wiki: Giant egg sac.

## From rsprox captures

rsprox.net recording 1507 (rev 224) carries the whole sequence:

| Tick | Action | Live response |
| ---: | --- | --- |
| 88 | Check-eggs, full sac | "There are 100 eggs left." |
| 90 | Cut-open, away from a bank, knife held | "You can only do this whilst in a bank." |
| 321 | Cut-open, same tile away from a bank, knife dropped at tick 319 | "You need to have a knife to cut the egg sac open." (the knife is checked before the bank) |
| 460 | Knife on the full sac, Varrock west bank, 6 free slots | slot keeps the open sac, 6 single `red_spiders_eggs` in the free slots; "You cut open the egg sac and receive 6 red spiders' eggs." |
| 495 | Check-eggs, open sac | "There are 94 eggs left." |
| 496 | Remove-eggs, full backpack | "You do not have enough inventory space." |
| 679 | Bank panel op9 (Empty), open sac | sac removed, +94 eggs in the bank; "You empty 94 red spiders' eggs into the bank." |

No animation, sound or varbit goes with any of these: the count is kept server-side. Here it is
item meta (`giant-egg-sac:eggs`) on the open sac, so it stays with the sac in the bank.
Recording 3932 (rev 236) only has pickups and a plain bank deposit of the full sac.

## Ours

- Cut-open with no free slot: refused with the Remove-eggs line instead of opening for none.
- Remove-eggs with room: no message, and the sac goes with its last egg (as the bank Empty does).
- Bank Empty into a full bank moves nothing, as the storage items' bank Empty.
- The full sac's bank-panel ops are left to the bank (only the open sac's Empty is captured).

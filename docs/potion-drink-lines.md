# Potion drink lines

What a potion says when drunk from the inventory (`server/plugins/items/Potions.plugin.js`).
All lines are spam (filterable) chat. Order, from rsprox captures:

1. the potion's lead lines, if it has any (`leadLines` in `registerPotion`);
2. its own drink line (`server/plugins/items/data/potion-drink-lines.json`), then the
   `tracking_potions_sipped` varp (below);
3. its effect's lines (anti-venom's "It grants you immunity from poison.");
4. the doses left, or "You have finished your potion.".

## Potions sipped

Varp `tracking_potions_sipped` (4519) counts every dose of a potion, on every world: +1 right
after the drink line, before the doses-left line (rsprox.net 236/03932 ticks 13, 95, 167), and the
total is sent at login when above 0 (03932: 0 -> 166; 238/04242: 0 -> 318). Each dose a chugging
barrel drinks counts, after its own line; a dose it refuses (a divine potion at low Hitpoints)
doesn't (04242.txt:42626-42643, 61023-61031). `Potions.plugin.js` keeps it in the persisted
attribute `potions:sipped` and answers `potions:sipped` (`{ player, count }`), which the league
summary's potions row reads.

What counts, from every inventory Drink in the rsprox.net index from rev 228 (when the varp first
shows): the Herblore potions (super restore 2162 of 2193 drinks, prayer 791/808, Sanfew 1020/1040,
Saradomin brew 923/1033, divine 428/429, stamina, goading, antifire, anti-venom, bastion,
Zamorak brew, prayer regeneration), and the Egniol (22/22), rejuvenation (6/6) and moonlight
(20/21) potions. Never counted (0 recorded): food, beers, ales, teas, rum, wines, sailing drinks,
the Blood Moon potions and congealed blood, the Chambers of Xeric potions, the Tombs of Amascut
path potions and the Soul Wars potion of power. The misses in the counted rows are drinks the
next click interrupted.

In `registerPotion`, `sipped` defaults to true unless the potion is kept to one `area` (Chambers
of Xeric, Blood Moon, Castle Wars); the drinks that are not potions (beers, ales, ciders, spirits,
teas, wines, cocktails) register through `registerDrink`, which sets it to false. The rejuvenation potion is drunk by `Supplies.Wintertodt.js`, which counts its dose with
the `potions:sip` event between its two lines (rsprox 233/03262.txt:4957-4960).

Ours: the barbarian mixes, the hunter's mixes, Guthix rest, Relicym's balm, Overload (+), the
Castle Wars brew and the Last Man Standing copies are not recorded. The Castle Wars brew doesn't
count (it is area-locked, like the other minigame potions recorded); the rest do, as potions (the
LMS copies drink as their potion).

## Sanfew serum

rsprox.net recordings 433 and 435 (rev 232) and 3034 (rev 231), Sanfew serum(4) Drink:
"You're temporarily immunised against poison.", "You've become immunised against disease.",
"You drink some of your Sanfew Serum.", "You have 3 doses of potion left.", all on the drink tick.
The two immunity lines are sent whether the player is poisoned (rec 433, varp poison 24 to -20),
diseased (rec 3034, varp disease 39 to -11, poison 0 to -20) or neither (rec 435, poison 0 to -20).
A drink while already immune is not captured.

Not modelled: disease. Live sets varp `disease` to -50 (the immunity) on each drink; tsps has no
player disease, so the Sanfew serum's disease immunity is the line alone. The chugging barrel
sends the same lead lines; its Sanfew serum is not captured.

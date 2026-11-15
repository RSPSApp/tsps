# Potion drink lines

What a potion says when drunk from the inventory (`server/plugins/items/Potions.plugin.js`).
All lines are spam (filterable) chat. Order, from rsprox captures:

1. the potion's lead lines, if it has any (`leadLines` in `registerPotion`);
2. its own drink line (`server/plugins/items/data/potion-drink-lines.json`), then the
   `tracking_potions_sipped` varp (below);
3. its effect's lines (anti-venom's "It grants you immunity from poison.");
4. the doses left, or "You have finished your potion.".

## Lines added from the local recordings

A rescan (2026-11-15) that took in the user's local recordings found lines for potions that sent
none. Each is spam, then the doses left as for every potion:

| Potion | Line | Recordings |
|---|---|---|
| Energy potion | "You drink some of your energy potion." | local 1001355-1001362 (rev 240), 1001421 (rev 241): 55 drinks |
| Defence potion | "You drink some of your defence potion." | local 1000410 (rev 227, Leagues) tick 33404 |
| Fishing potion | "You drink some of your fishing potion." | local 1000438 (rev 227, Leagues) tick 7793 |
| Antidote++ | "You drink some of your antipoison potion." | rsprox.net 907 (rev 235), local 1001295 (rev 236) |
| Extended antifire | "You drink some of your extended antifire potion." | local 1002134 (rev 242) ticks 7054, 9585 |
| Ancient brew | "You drink some of the foul liquid." | local 1000463 (rev 227, Leagues) tick 12180 |
| Xeric's aid (+) | "You drink some of your strong Xeric's aid potion." | local 1000495 (rev 227) ticks 2216, 2700, 4476 |
| Revitalisation (+) | "You drink some of your strong revitalisation potion." | local 1000495 (rev 227) ticks 2325, 3002 |

The Chambers of Xeric gourd's last dose ends with "You have finished your potion. The gourd vial
disintegrates." as spam (local 1000495 ticks 2216, 2325, 4476), not a game message.

Moonlight mead sends "You drink the foul smelling brew." and "It tastes like something just died
in your mouth." (spam, rsprox.net rec 365, rev 231) and leaves a beer glass. The mature mead's
lines are not recorded, so it sends none.

Not added: Guthix rest. Its one recording (rsprox.net 1858, rev 227, Leagues, a (3) cup) sends
"You drink the herbal tea." and "The tea boosts your hitpoints." with no doses-left line; the last
cup and a drink at full Hitpoints are not recorded, so it still sends only the doses left.

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

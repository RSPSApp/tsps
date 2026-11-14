# Potion drink lines

What a potion says when drunk from the inventory (`server/plugins/items/Potions.plugin.js`).
All lines are spam (filterable) chat. Order, from rsprox captures:

1. the potion's lead lines, if it has any (`leadLines` in `registerPotion`);
2. its own drink line (`server/plugins/items/data/potion-drink-lines.json`);
3. its effect's lines (anti-venom's "It grants you immunity from poison.");
4. the doses left, or "You have finished your potion.".

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

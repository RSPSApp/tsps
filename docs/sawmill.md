# Sawmill

`server/plugins/npcs/Sawmill.plugin.js` runs the sawmill operators: "Sawmill operator" (3101) and "Sawmill Operator" (9140 in Prifddinas, 14659 in Auburnvale). Its data is in `server/data/definitions/sawmill.json`.

The rules come from rsprox captures (`rsprox/sawmill/operator*.txt`) and the OSRS Wiki.

## Buy-plank
Buy-plank opens the skillmulti menu (270, clientscript 2046):
- **Mode:** 0.
- **Title:** "How many do you wish to make?"
- **Maximum:** the logs you carry.
- **Starting amount:** the last amount you chose (the first time, the maximum).
- **The seven planks:**

  | Plank | Logs | Plank id | Cost |
  | --- | --- | --- | --- |
  | Wood | 1511 | 960 | 100 |
  | Oak | 1521 | 8778 | 250 |
  | Teak | 6333 | 8780 | 500 |
  | Mahogany | 6332 | 8782 | 1,500 |
  | Camphor | 32904 | 31432 | 2,500 |
  | Ironwood | 32907 | 31435 | 5,000 |
  | Rosewood | 32910 | 31438 | 7,500 |

The core's creation menu now takes per-item labels, a maximum, a starting amount and a mode as optional settings. Existing menus are unchanged.

**Spacebar picks the item you made last.** The menu's clientscript (2046) gives the space key to the item at the position held in varp 2673, for every menu type whose enum 3623 entry is 1, the default. So every make-X menu now:
- remembers the position you chose (`creation-menu:last-item`, saved);
- sends it as varp 2673 before the menu opens.

On choosing, everything happens that tick, with no animation and no message.
- **No logs:** the operator says "You'll need to bring me some more logs."
- **Otherwise, plank by plank** until the amount, your logs or your coins run out:
  1. the coins are taken;
  2. then a log;
  3. then the plank goes into the first free slot.

  So a plank takes its log's slot, or the coins' slot once the coins are gone. The capture shows the latter: 2 logs and 1,500 coins made 1 plank, which landed in slot 1, where the coins had been.
- **Coins running short:** "Those planks cost 1500 coins. You don't have enough money for all of them." The line gives the plain unit price. It's said even when no plank could be made.

## Using logs on the operator
A log used on any operator makes **one** plank on the spot, with no menu. It works plank by plank as above, so the plank lands in the first log's slot (captured). Without enough coins you get the same "Those planks cost …" line.

## Sawmill vouchers (Wiki)
While you carry a voucher (28628), each log uses one and makes 2 planks for that log's price, as long as there's room for the second plank. If there isn't, the log makes 1 plank and the voucher is kept.

Out of scope, since neither exists on this server yet:
- the Sailing log-type coupons;
- the plank sack.

## Talk-to and Trade
- **Talk-to** plays the Wiki transcript, which matches the capture:
  - "Yes, please make me some planks." opens the same menu, a tick after the conversation closes;
  - "Can I buy some housing supplies?" opens the shop.
- **Trade** opens the same shop, "Construction supplies".

The duplicate "Sawmill" shop, with the same stock and operators, is removed.

## Diary
- **Varrock easy:** "Make a normal plank at the Sawmill" (any wood plank made).
- **Varrock medium:** "Make 20 Mahogany Planks in one go" (20 or more from one choice).

## Not modelled
The Sawdust (9468) that appeared on the floor once in a capture. It wasn't seen again, and it's likely unrelated.

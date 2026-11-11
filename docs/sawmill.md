# Sawmill

`server/plugins/npcs/Sawmill.plugin.js` runs the sawmill operators: "Sawmill operator" (3101) and "Sawmill Operator" (9140 in Prifddinas, 14659 in Auburnvale). Its data is in `server/plugins/npcs/data/sawmill.json`.

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

## Sawmill coupons (Wiki)
The Sailing coupons ([Sawmill coupon](https://oldschool.runescape.wiki/w/Sawmill_coupon)) each pay one plank's fee at a sawmill, for their own log only. There's one for every plank except rosewood:

| Coupon | Id | Pays for |
| --- | --- | --- |
| Sawmill coupon (wood plank) | 32083 | Logs |
| Sawmill coupon (oak plank) | 32085 | Oak logs |
| Sawmill coupon (teak plank) | 34068 | Teak logs |
| Sawmill coupon (mahogany plank) | 34070 | Mahogany logs |
| Sawmill coupon (camphor plank) | 34072 | Camphor logs |
| Sawmill coupon (ironwood plank) | 34074 | Ironwood logs |

Each of these ids is followed in the cache by its bank placeholder (32084, 32086, 34069 ...), which is never redeemed.

- Plank by plank, a log whose coupon you carry spends one coupon instead of the coins and makes one plank. Once the coupons run out, the coins pay for the rest, with the usual "Those planks cost …" line if they run short.
- A coupon can't be combined with a voucher for two free planks; with both carried, the coupon is used and the voucher kept.
- Using a log on the operator redeems a coupon in the same way.
- Coupons don't work with Plank Make (Lunar), which never looks at them.

Not captured: neither the user's rsprox recordings nor the rsprox.net index has a coupon redemption, so the menu keeps its priced labels and no message is sent for a coupon plank. Ours: coupon planks leave sawdust like paid ones (the Wiki's Sawdust page says any conversion does).

## Talk-to and Trade
- **Talk-to** plays the Wiki transcript, which matches the capture:
  - "Yes, please make me some planks." opens the same menu, a tick after the conversation closes;
  - "Can I buy some housing supplies?" opens the shop.
- **Trade** opens the same shop, "Construction supplies".

The duplicate "Sawmill" shop, with the same stock and operators, is removed.

## Diary
- **Varrock easy:** "Make a normal plank at the Sawmill" (any wood plank made).
- **Varrock medium:** "Make 20 Mahogany Planks in one go" (20 or more from one choice).

## Sawdust
The [OSRS Wiki's Sawdust page](https://oldschool.runescape.wiki/w/Sawdust) says paid plank conversion leaves sawdust at the player's feet, available even to other ironmen. The active cache identifies this as `newsletter_sawdust` (9468), named Sawdust.

Successful conversion leaves one public, unowned pile on the player's tile for 200 ticks. An existing public pile on that tile/private area is reused. In normal-world rsprox 1655, tick 152 makes one mahogany plank and creates quantity 1 with 199 ticks remaining; tick 163 makes two more planks without creating another pile while the first remains. A failed payment creates none. Capture 3225 independently shows the same public quantity and lifetime. These captures support existing-pile suppression; other possible conditions are unverified.

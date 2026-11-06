# Rogue Trader

Ali Morrisane's three errands after The Feud (Wiki: Rogue Trader). Code: `server/plugins/npcs/RogueTrader.plugin.js`, with
`rogue-trader/Runedoku.RogueTrader.js` (the sudoku) and `rogue-trader/Shops.RogueTrader.js` (the per-player rune, blackjack and clothes
shops). Wording: `server/plugins/npcs/data/rogue-trader.json`.

## State

One saved attribute, `rogue-trader:state`, resent as the captured varbits at login:

| Varbit | Name | Values |
|---|---|---|
| 911 | `roguetrader_blackjacks` | 1 asked, 2 told the seller, 4 defensive blackjacks, 3 offensive |
| 912 | `roguetrader_clothes` | 1 asked, 2 Siamun asked, 3 Menaphite (dyes), 4 desert (pelts) |
| 913 | `roguetrader_runes` | 1 asked, 2 Aubury agreed, 3 small casket open, 5 large casket open |
| 914 | `roguetrader_cheapflights` | 1 the carpet discount |
| 915, 916, 917, 919, 920 | `justchanged_garments`, `justchanged_weapons`, `justobt_runes`, `bj_urchingloat`, `bjtold_ali` | what Ali has already been told |
| 922 | `roguetrader_stallvar` | the stock last viewed: 1 runes, 2 blackjacks, 3 desert outfits, 5 Menaphite clothes |

## Evidence

Everything above is from rsprox 3169 and 1756 (the start), 3170 (runes, blackjacks, clothes, the stocks) and 549 (Aubury, Siamun, the
finish), found by searching the decodes for varbits 911-922 and NPC 3533. The tests replay them through real packets
(`server/tests/rogue-trader-*.test.cjs`, fixtures in `server/tests/fixtures/rogue-trader/` made from the decodes).
The generated `npc-dialogues.json` has Ali Morrisane's variant `standard-dialogue-after-completing-rogue-trader` (the blackjack, clothes and
runes/casket menus and the expand-your-business answers), which Ali's later visits use, cut to what the player has unlocked and with the
reports, the thanks and a reminder option added; the Captain Dalbur options are hidden because nothing tracks that question. It has no
page for the miniquest's own conversations (Ali's introduction, reminders, reports and thanks, Aubury's proposal, Siamun, the blackjack
seller, the street urchin), and it is generated, so that wording is held in `rogue-trader.json` (`scenes` from the captures, `wikiScenes`
from Transcript:Rogue Trader where no capture has the branch, `oursScenes` for what neither has).

The runedoku (interface 292) board is 81 nibbles in the varps 2980-2990 (LSB first, row-major, 0 empty); the client keeps the placed
runes, so the server tracks the clicks (292:9 selects a rune, 292:14 places it) and checks a solved sudoku when Open (292:10) is pressed.
Only two boards are in any capture; they are the pool.

Selling: Ali pays half an item's value for runes in his casket, elemental and other-runes shops (`shop:sell-price`; Wiki `buymultiplier=500`),
so the "Buy all" offer cannot be sold back for a profit. A casket's own shop holds its runes as surplus: they fall back instead of restocking. His blackjack and clothes shops keep the repo's default sell price.

The generated post-errand remarks at Dommik, Ellis, Karim, Zeke, and the Al Kharid shop keeper and assistant require all three
errands and Prince Ali Rescue (Wiki, Post-errand task). The existing errand-completion state supplies the three-errand check.

## Not captured (ours or the Wiki's, labelled where sent)

915 going back to 0 when Siamun switches from the desert outfits to the Menaphite clothing: 3170 has only the Menaphite-to-desert switch (915 1 -> 0 at t1367); the reset on the way back is symmetrical, not captured.
What a later visit says when it gives an errand the introduction would have given (catch-up for a player who left a menu or finished Icthlarin's Little Helper later): the introduction's wording, ours.

Small-casket Pick success and Examine, the strength and agility drains, the "Buy all" discount (the two offers, 890 and 33156, are 86% and
76% of the shop prices), the casket contents, a hit that knocks the player out, the urchin's 300 gold after an unpaid Feud debt, the first-time
knock-out route, what a player at 912 = 2 meets.

## Not done

The four Alis (6552-6555), whose generated pages are empty. The Captain Dalbur options of "I hear you're planning to expand your business
here..." are hidden. The per-player shops start over at logout.

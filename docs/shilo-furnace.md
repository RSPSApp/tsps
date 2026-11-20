# Shilo Village furnace (Yohnus' coffer)

`server/plugins/world/ShiloFurnace.plugin.js`. Yohnus charges 20 coins a use of his furnace,
paid from a per-player coffer that holds up to 40,000 coins. The elite Karamja Diary makes it free
(OSRS Wiki: Yohnus, Furnace, Shilo Village (location), Transcript:Yohnus).

## The loc

`zqfurnace` (29662) is a multiloc on varp 116 (the Shilo Village quest). Before the quest it shows
`zqfurnace_unlit` (30157, no options); after it, `zqfurnace_lit` (30158, "Furnace": Smelt,
Coffer). Yohnus is `shilofurnaceowner` (5359: Talk-to, Coffer).

## What rsprox captures show

Rev 227 (Leagues V) recordings local 1000217, 1000230, 1000262, 1000334, 1000359, 1000410,
1000412, 1000451, 1000458, public 1749; rev 231 public 3030.

- **Coffer** (loc op3 or Yohnus op3): a `chatmenu` titled "Furnace coffer: N coins" with
  "Deposit coins | Empty coffer | Cancel" (1749 t+1, 3030 t+3). After the elite diary the first
  option is `<str>Deposit coins</str>` (3030).
- **Deposit coins**: a count prompt "How much do you wish to deposit? (20 - 40,000 coins)"
  (1749 t+5). 200,000 entered put 40,000 in, played synth 2115 and reopened the menu with the
  new total (1749 t+10).
- **Smelt, coffer empty**: "Your coffer is empty." with "Add one use: 20 coins | Add N uses:
  N×20 coins | Cancel". N is what the coins carried and the coffer's room allow: 10 with 204
  coins, 9 with 184, 2,000 with a large stack (local 1000359 t+5, 1000217 t+5).
- Choosing one: the coins go (synth 2115), the use is taken from the coffer at once and the
  furnace's own interface opens (skillmulti, crafting_gold ...). A coffer left at 0 says
  "<col=ff0000>Your coffer is empty. You must top it up before you can use the furnace again."
  (local 1000359 t+14).
- **Smelt, coins in the coffer**: "Furnace coffer: N coins" with "Pay 20 coins to use the
  furnace. | Pay 20 coins and don't ask again. | Cancel." (local 1000230, 1000412 t+2, 1749).
  After a deposit of 40,000 the next prompt reads 39,980, so the first use was taken.
- **Don't ask again**: Smelt then says "Your coffer contains 8,600 coins, enough for 430 more
  furnace uses." and opens the furnace at once (local 1000262 t+4, 1000334 t+3, 1000458).
  An item used on the furnace says nothing and opens its interface (local 1000334 t+17,
  1000412 t+949, 1000451).
- **Any item** used on the furnace asks first, seaweed and soda ash too (local 1000359).
- One payment covers one click, whatever is made: two silver bars smelted in one go (local
  1000334 t+7 to t+16).

## Ours

- With coins for one use only, the second "Add N uses" line is left out (not recorded).
- "Your coffer contains ..." names the coffer after this use is taken.
- In "don't ask again" an item use is charged without a message: the recordings show no message,
  and the Wiki charges every use.
- A full coffer's Deposit coins reopens the menu (not recorded).
- Talk-to still plays Yohnus' transcript; its own Deposit coins / Empty coffer choices are not
  wired to the coffer.

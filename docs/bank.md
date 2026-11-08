# Bank

## Messages (rsprox captures)

| Action | Message | Recordings |
| --- | --- | --- |
| Withdraw with no free inventory slot | `You don't have enough inventory space.` | 454, 3066 |
| Withdraw more unstackable items than there are free slots (the rest are taken) | `You don't have enough inventory space to withdraw that many.` | 4151, 3467 |
| Click the empty slot after the last tab | `To create a new tab, drag items from your bank onto this tab.` | 1059 |

Our code does not shorten a withdrawal of a stackable item or of a noted one, so those send neither message; I did not check that against a recording.

Not yet implemented, seen live: `Some of your items cannot be stored in the bank.` on Deposit inventory
(recording 717), and `Upgrade to a Jagex Account to unlock more bank space.` (recording 1636).

## Bank space

`plugins/interface/BankSpace.plugin.js` with `plugins/interface/data/bank-space.json`. Core
(`Bank.ts`) holds one limit across every tab: it asks `bank:capacity` for it and counts
placeholders as slots. Each tab grows as needed, up to the client's 1410 slots. A full bank still
takes more of an item it already holds, and notes of it. Items moving between tabs, and a saved
bank holding more than the player's space, ignore the limit.

The capacity, from the [Wiki](https://oldschool.runescape.wiki/w/Bank):

- 900 slots for members, 400 free-to-play;
- +20 with a Bank PIN in effect (a pending one does not count);
- +40 as a Jagex Account. Neither Jagex Accounts nor the Authenticator exist here, so every
  account gets these 40; live's tooltip names only the Jagex Account;
- +50 per block bought from a Banker, up to 9 blocks: 1M, 2M, 5M, 10M, 20M, 50M, 100M, 200M
  and 500M coins (888M for all). The capture below confirms blocks 3-9.

An rsprox capture (rev 241) of a members account on a Jagex Account, with 2 blocks bought and no PIN:

| What | Live |
| --- | --- |
| Bank open | `bankmain:capacity` (12:8) set to `1040`; script 1495 with `Members' capacity: 900<br>+100 that you've purchased.<br>A banker can sell you up to 350 more.<br>Set a PIN for 20 more.<br>+40 as a Jagex Account.`, `bankmain:capacity_layer` (12:7), `bankmain:tooltip` (12:111) |
| Depositing into the full bank | `Set a Bank PIN to unlock more bank space.` |
| Banker, "I'd like to buy more bank slots." | `I can sell you up to 350 additional bank slots in sets of 50. How many are you interested in buying?`, then `menu_new` (947) opens in the main modal: scripts 2524 [-1, -1] and 9142 (`How many do you wish to purchase?`, the options joined by `\|`, 0, -1, 0, 0), events PAUSEBUTTON on 947:9 slots 0-512, and the chatbox closes |
| The list | `50 slots (5,000,000 coins)\|100 slots (15,000,000 coins)\|...\|350 slots (885,000,000 coins)\|\|Do I have any other options for extra bank space?\|(Cancel)`; a pick resumes 947:9 with its index |
| Picking 50 | `50 slots please.` then `Buying 50 additional bank slots will cost 5,000,000 coins. Be warned, this purchase is not reversible. Are you happy to proceed?` |
| 10M coins in the bank, none carried | `Oh... I don't seem to have enough money for that. Never mind.`: no Yes/No. The recording's bank coins didn't pay, but the Wiki transcript (Transcript:Banker) says they do and the server follows the Wiki: the inventory's coins pay first, then the bank's, and the refusal comes only when neither holds enough |
| 5M coins carried | Chat menu `Buy 50 bank slots for 5,000,000 coins?` with `Yes.\|No.`; `Yes, I'm happy with that.`; on continuing, the coins leave the inventory, `bank_extra_blocks_purchased` (varbit 13119) goes 2 -> 3, sound 2114 plays and the Banker says `Your additional bank slots have been added.` |

A second capture (3 blocks bought, a PIN just set and pending):

| What | Live |
| --- | --- |
| "Do I have any other options for extra bank space?" | The player says it (face 554), the Banker `I'm not supposed to tell you this, but you can obtain more bank space by setting up a PIN.` (593), then the offer again (568) and the list reopens |
| "(Cancel)" | The player says `Actually, I've changed my mind.` (575) and the conversation ends |
| The list's numbering | The client numbers only the lines with text (script 9143), so with 6 options "other options" resumes 6 and "(Cancel)" 7. Live's server counts the blank spacer, so it answers 6 with Cancel and 7 with "other options": the two swap. We number as the client does, so each line does what it says |
| Bank open, PIN pending (7 days) | Capacity `1090` and `Set a PIN for 20 more.`: a pending PIN doesn't count yet |

Not in the captures, so these follow the Wiki transcript or are guesses:

- "No." at the Yes/No uses the Wiki transcript's line.
- About half the generated Banker transcripts still offer slots "in sets of 40" (an older Wiki
  transcript). The plugin replaces that whole line with the captured one, which also fills in
  the slots for sale; `npc-dialogues.json` is unchanged.
- The tooltip with a PIN set (`+20 for having a Bank PIN.`) and on a free-to-play world
  (`Free-to-play capacity: 400`) is guessed. The lines for purchased slots and slots for sale
  are left out at 0.
- Live's full-bank message once a PIN is set: we keep `Not enough space in bank.`. Recording
  1636 has `Upgrade to a Jagex Account to unlock more bank space.`, which can't apply here.
- What the Banker says once all 9 blocks are bought: we still offer "up to 0", and the list
  holds only the other two options.
- The capture also raises `tracking_coins_lost` (varp 4513) by the price. This server doesn't
  track that, so it isn't sent.

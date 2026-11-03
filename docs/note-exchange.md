# Banknote exchange merchants

`server/plugins/npcs/NoteExchange.plugin.js` lets players use a banknote on a banknote exchange merchant to get the real items back, for a fee per note. Each merchant's fee, members status, accepted items and own lines are in `server/plugins/npcs/data/note-exchange.json`.

Talk-to is not part of this plugin. It plays each merchant's Wiki transcript from `data/definitions/npc-dialogues.json`.

Sources:
- the OSRS Wiki: each merchant's page and transcript, the "Banknote merchant" navbox, Exposed altar and Blessed bone shards;
- rsprox captures of Virilis (<https://rsprox.net/database>, recording 1104, rev 237, a Leagues VI world). Five uses of noted Dagannoth bones, each followed by "Exchange all".

There are no captures of the other merchants' exchange. Phials, Tiles, Aisles and the Pollnivneach merchant only have Talk-to recordings, and the Elder Chaos druid only appears in passing. They share Virilis's flow, with their own fee and Wiki lines.

## Merchants

| Merchant | NPC (gameval) | Where | Fee | Members | Takes |
| --- | --- | --- | ---: | --- | --- |
| Phials | 1614 `uncerter_rimmington` | Rimmington | 5 | No | any banknote |
| Tiles | 2133 `uncerter_bandit` | Bandit Camp (desert) | 5 | Yes | any banknote |
| Aisles | 2134 `uncerter_jiminua` | Jiminua's Jungle Store | 5 | Yes | any banknote |
| Banknote Exchange Merchant | 1615 `uncerter_pollnivneach` | Pollnivneach | 5 | Yes | any banknote |
| Biles | 15393 `biles` | Tear of the Soul (61 Sailing to reach) | 5 | Yes | any banknote |
| Elder Chaos druid | 7995 `wild_chaos_uncerter` | Chaos Temple, level 38 Wilderness | 50 | No | bones |
| Virilis | 13346 `vm_prayer_uncerter` | Ralos' Rise | 10 | Yes | bones blessable at the exposed altar, plus burnt bones |

Members status is each NPC's Wiki infobox. Tiles is members; only Phials and the Elder Chaos druid are free-to-play. On a free-to-play world the members merchants don't exchange anything.

The attackable Elder Chaos druids (6607 `wilderness_chaos_druid`) share the name, so merchants are keyed by NPC id, not name.

- **Elder Chaos druid:** the Wiki says he unnotes "any type of bones", the ones that can be offered on the Chaos altar. This is every item whose unnoted form has a Bury option in the cache.
- **Virilis:** the bones the exposed altar blesses (the Blessed bone shards table): bones, bat, big, zogre, babydragon, wyrmling, dragon, lava dragon, wyvern, superior dragon, wyrm, drake, hydra, fayrg, raurg, ourg, strykewyrm and frost dragon bones. Dagannoth bones are included too, since the capture shows him exchanging them. Burnt bones are included from the Virilis trivia note, though they can't be blessed.

Left out:
- **Isles** (`grimstone_uncerter_*`): he only exchanges once the player has sailed him from Port Roberts to Grimstone and he has moved to the Ancient Furnace. That escort doesn't exist here yet. He also takes only cannonball bars, for 100 coins each.
- **Piles** (Wilderness Resource Area): he notes items rather than unnoting them.

## Using an item on a merchant

These checks run in this order (refusal lines from the Wiki transcripts):

| Case | Line (NPC chat) |
| --- | --- |
| Not a banknote | "I exchange banknotes for real items. That's not a banknote." (Virilis: "I'm afraid I can only exchange bank notes for real items.") |
| A banknote the merchant doesn't take | druid: "I only exchange items that can be offered as a sacrifice to The Dark Lord's altar."; Virilis: "I only exchange bones that you can bless at Ralos' altar." |
| Fewer coins than one fee | "I charge <fee> coins for exchanging each banknote." (Virilis: "I require 10 coins for exchanging each banknote.") |
| No room for even one item | "Your inventory is too full." |

The Wiki's order of these checks isn't known. The same lines are used for every merchant, because Phials, Tiles and the Pollnivneach merchant have none of their own on the Wiki.

Otherwise the exchange menu opens (captured):
- **Title:** "Exchanging: <item name>"
- **Options:**
  - "Exchange 1 (<fee> coins)."
  - "Exchange 5 (<5 × fee> coins)."
  - "Exchange all (<notes held × fee> coins)."
  - "Exchange X."
  - "Cancel."

"Exchange X." asks for an amount. The prompt text, "Enter amount:", is ours; no capture shows it.

The Elder Chaos druid remembers the last positive X entered, saved per character. On later exchanges, that amount replaces the 5-item shortcut, including its 50-coins-per-item price; Exchange X remains available to change it. Notes, coins and inventory space still cap the exchange. This addresses the remembered-quantity report in #2095; the exact placement of the remembered amount in the OSRS menu has not been independently captured.

## The exchange

The exchange is all done on the tick of the choice (captured):
- **How many:** the amount asked for, capped by the notes held, coins ÷ fee, and free slots. Stackable items need no slots. A note stack or coin stack that is used up in full frees its slot.
- **Items:** the notes and the coins (count × fee) go, and the unnoted items arrive.
- **Sound:** synth 2417.
- **Item box:** objectbox (193) with the unnoted item, "<Name> converts your banknotes."

All the captured exchanges were of several notes. Whether a single note reads "banknote" isn't known.

The capture only shows Virilis's "converts" line. "The Banknote Exchange Merchant converts your banknotes." and "The Elder Chaos druid converts your banknotes." are ours.

## Differences from the Wiki
The Isles transcript (2026) shows a different menu: "Exchange [item]?", then "Exchange 1: 100 coins.", "Exchange 5: 500 coins.", "Exchange X." and "Cancel.". The Aisles transcript lists "Exchange [item name]: 5 coins", "Exchange All: …" and "Cancel". Both are written by hand. The capture is followed because it is first-hand.

# Alchemy

High Level Alchemy and Low Level Alchemy on the standard spellbook turn one inventory item into
coins (`MagicOnItemPacketListener.castAlchemy`). Plugins shape a cast through the
`magic:alchemy-policy` event and hear about it through `magic:alchemy-completed`.

## Live behaviour

Sources: the OSRS Wiki pages
[High Level Alchemy](https://oldschool.runescape.wiki/w/High_Level_Alchemy) and
[Low Level Alchemy](https://oldschool.runescape.wiki/w/Low_Level_Alchemy), and rsprox captures
3215 (rev 232: fifteen warned casts and one on an untradeable item), 338 (rev 230: the
valuable-item warning and the Warnings option), 4031 (rev 237: a cast inside Pest Control) and
1098 (rev 237, a Leagues VI world: the Low Level Alchemy animation and graphic).

| | High Level Alchemy | Low Level Alchemy |
| --- | --- | --- |
| Level, runes | 55, 5 fire + 1 nature | 21, 3 fire + 1 nature |
| XP | 65 | 31 |
| Cast every | 5 ticks (Wiki) | 3 ticks; 5 in the Alchemists' Playground (Wiki) |
| Animation, graphic | 713 `human_casthighlvlalchemy`, 113 `highlvlalchemy_casting` | 712 `human_castlowlvlalchemy`, 112 `lowlvlalchemy_casting` |
| Sound | 97 (capture 3215) | 98 (not captured) |

- **Queued casts.** "If you cast a second alchemy spell before your last one finishes, it's now
  queued up" (Wiki, update of 13 April 2013).
- **Untradeable items alch.** Capture 3215 alchs a broken Iban's staff (`brokenibanstaff`, 1410)
  for 12 coins. Before the cast an objectbox (193) shows the item with
  "That item cannot be traded.<br>Really cast High Level Alchemy on it?" (also sent as a mesbox
  chat message), then a chatmenu titled with the item's name: "Proceed to cast High Level Alchemy
  on it." / "Cancel the alchemy spell.". Proceed casts on that same tick. The Warnings option
  (capture 338) says "Untradeable items will always trigger a warning."
- **Pest Control** refuses the cast with "There are more pressing matters at hand than alchemy!"
  and nothing is cast: no animation, inventory or XP change (capture 4031).

## In tsps

- `magic:alchemy-next-cast` holds the cycle the next cast may go off; a click before then is
  kept in `magic:alchemy-queued` and cast by a task when the delay ends (checked again then:
  the item must still be in its slot, runes and level still there). Only one cast waits; a
  later click replaces it (the Wiki says only that the second cast is queued).
- The policy event carries `allowed`, `coins`, `castTicks` and `confirm`. The Alchemists'
  Playground sets `castTicks` to 5 for both spells; it and While Guthix Sleeps' lit explosive
  turn the cast into something else and clear `confirm`, so they ask nothing.
- Items flagged untradeable by the server itself (PvP preset items) are still refused with
  "This spell can not be cast on this item.", as are coins and items without an alchemy value.
- Zone rules go through `onSpellDisabled` like every other spell (Pest Control).

## Not done

- The valuable-item warning ("That item is considered <col=7f0000>valuable</col>. Really cast
  High Level Alchemy on it?", captures 338 and 3215) and the Warnings option that sets its
  threshold: it is judged on Grand Exchange value against a player-set threshold, and no capture
  or Wiki page gives the default threshold.
- The Explorer's ring's free casts (Wiki: 30 a day with ring 4, no XP); see
  [diary-rewards.md](diary-rewards.md).

### Inventory priority

High and Low Level Alchemy consume the first equivalent item in inventory slot order,
so repeated casts targeting a later copy leave that copy until the earlier copies are gone
(#2396). Equivalence uses the container's item-ID and metadata comparison: a preset-protected
or differently charged copy is kept separate. Queued casts and confirmations still require
the originally clicked instance to remain in its slot; alternative payments receive the
instance and slot actually consumed.

The priority behavior is the reporter's OSRS observation. Captures 3215, 3238, 3236, 337
and 4270 did not target a later duplicate and therefore do not independently prove that
ordering. The cache supplies the spell widgets; both real Gateway IF_BUTTONT packets and
native Player widget-target regressions check the resulting slot order.

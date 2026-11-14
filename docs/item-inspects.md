# Item Inspect object boxes

Some items answer Inspect with only a line beside the item. `server/plugins/items/ItemInspects.plugin.js`
hooks each one by its cache name, and `server/plugins/items/data/item-inspects.json` holds the lines.
To add an item, add its name and line there, with the recording it came from.

## Live behaviour (rsprox captures)

From rsprox.net index recordings, revision 235 (the vyre noble pieces: revision 226). On the click tick (or the tick after, when the
player was still arriving), live sends:

- the line to the chat as a `mesbox` message, on one line;
- the object box (`chatbox:chatmodal` = `objectbox`, interface 193) with `objbox_setbuttons`
  "Click here to continue";
- the item on `objectbox:item` at zoom 400;
- the line on `objectbox:text`, broken with `<br>` where the dialogue layout wraps it
  (`ChatTextLayout.wrap` gives the same breaks for every item below).

Nothing changes in the inventory.

| Item | Recordings |
|---|---|
| Stormy key | 856 (tick 1247), 3461 (tick 1950), 3457 (tick 496) |
| Fetid key | 908 |
| Serrated key | 936 (twice) |
| Barrel stand | 3457, 3461 |
| Bottled storm | 937 |
| Captured wind mote | 908 (tick 9647) |
| Gurtob's fabric roll | 908 (tick 9638) |
| Gwyna's fabric roll | 936 (tick 15961) |
| Ralph's fabric roll | 3461 (ticks 1089, 1945) |
| Heart of Ithell | 936 (ticks 5134, 15957) |
| Vyre noble top, legs and shoes (unscented) | 1637 (ticks 4660-4661, one after another; each box replaced the last) |

## Not covered

Other items whose cache options include Inspect with no handler (echo pearl, narwhal horn, ray
barbs, aquanite tendon, reef snake gland and more) have no Inspect recording yet, so they are left
out rather than guessed. Inspect lines that depend on state are left to their features: the Death
on the Isle evidence (quest varbits), the broken zombie axe (its line names the player's skill), the
torn master clue parts (Combine), the Mastering Mixology potions (quality) and the DT2 quartz (Leagues
recordings only).

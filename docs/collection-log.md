# Collection log

The collection log lives in `server/plugins/collectionlog/`. What it holds (tabs, categories and their items) is read from the cache. What a player has obtained, each category's count and the overview's recent items are persisted per player.

## What counts

- **Loot counts the moment it drops**, not when it's picked up:
  - **Through `npc-drops:roll`:** every roll is read once its handlers have finished editing it. That covers NPC drops, the Gauntlet's chest and Doom's delve loot (its unique included).
  - **Through `collection-log:obtain`,** for content whose loot doesn't go through that roll:
    - ToA: as in OSRS, when the loot is claimed, i.e. when the sarcophagus is searched or a chest opened, each entry once;
    - Wintertodt: each crate reward;
    - the Colosseum: each wave's loot;
    - the Inferno and the Fight Caves: their capes.

    ToA, Wintertodt, the Colosseum and the Inferno roll only their pets through `npc-drops:roll` (Pets takes them from there), so no loot is counted twice.
- **Kills tally the category of the same name,** e.g. killing Zulrah adds to "Zulrah". Plugins that keep their own count answer for it instead (Zulrah, the Kalphite Queen).
- **Pets** report through the log (owned pets are synced silently on login).

From another plugin:

```js
api.emitCustomEvent("collection-log:obtain", { player, itemId, amount: 1 });   // ensure / silent optional
api.emitCustomEvent("collection-log:count", { player, category: "Barrows Chests", amount: 1 });
api.onCustomEvent("collection-log:category-count", (request) => {             // a kept count
  if (request.category === "Zulrah") request.count = kills(request.player);
});
```

**Admin command:**
- `::clog <item name|id> [amount]` obtains through the real path;
- `::clog count <category> <n>` sets a count;
- `::clog reset` clears the log.

## The cache

| What | Where |
| --- | --- |
| Tabs | Structs 471–475: param 682 the name, 683 an enum of category key → category struct, 684 the tab index |
| A category | Struct param 689 the name, 690 an enum of position → item |

Our cache (revision 237) has 5 tabs, 122 categories and 1,703 distinct items. Live OSRS, where the captures come from, has a few more categories (57 boss categories to our 55), so category keys differ between the two. The client uses the same cache as the server, so they always agree with each other.

The client reads the log straight from its cache too. It used to override these enums and struct params with a bundled snapshot of an older cache (revision 235, `client/common/collectionlog/`). That put its categories one off from the cache, e.g. Zulrah at 53 instead of 54, so the snapshot was removed.

## From the captures

**Login** sends:
- `collection_count` (2943) and its maximum (2944);
- per tab, the count and maximum: bosses 4613/4614, raids 4615/4616, clues 4617/4618, minigames 4619/4620, other 4621/4622;
- `collection_count_highscores` (4612) and `collection_count_unsynced` (4848);
- the 12 recent items at varps 4623, 4625 … 4645, each followed by its day number (days since 27 February 2002, UTC);
- `option_collection_new_item` (varbit 11959) = 3, for chat message plus popup.

**Opening the log** (account summary, row 6):
1. the last category's items in `collection_transmit` (620);
2. `collection` (621) opened in the floater (161:18);
3. OP1 on the burger menu (621:73, slots 10–12), the A–Z, space, backspace and tab keys (621:42–70), the search buttons (621:75–76) and the open tab's category rows;
4. `collection_draw` (script 7797) `[tab, container, background, text, scrollbar, tab struct, category]`.

| Tab | Struct | Button | Container | Background | Text | Scrollbar |
| --- | --- | --- | --- | --- | --- | --- |
| Bosses | 471 | 621:4 | 10 | 11 | 12 | 13 |
| Raids | 472 | 621:5 | 14 | 15 | 16 | 23 |
| Clues | 473 | 621:6 | 24 | 32 | 33 | 25 |
| Minigames | 474 | 621:7 | 26 | 27 | 36 | 28 |
| Other | 475 | 621:8 | 29 | 34 | 35 | 30 |

**A category** (a row on the tab's background, sub = its key), in this order:
1. `collection_category_count` (varp 2048): the category's count, shown by cache script 2735 ("Zulrah kills: 1").
2. `collection_last_category` (varbit 6906).
3. The obtained items in 620, **packed from slot 0** in category order. Zulrah's scales are its 10th item but arrive in slot 0.
4. `collection_draw`.

**A tab** sets `collection_last_tab` (varbit 6905), resets to its first category and enables its rows.

**Search:** every key typed sends:
1. OP1 on the results (621:84, 0 to the global category total);
2. one `collection_delayed_transmit` (script 4100) `[item, count, global category number, category struct]` per obtained item and category. The global number is a category's key plus the key ranges of the tabs before it.

**The overview** (908): the burger menu's slot 12 closes 621 and opens 908 in the floater, with OP1 on 908:7 (10–12), 908:22 (0–4) and 908:21 (0). Its section buttons reopen the log on that tab. Both close with `chatdefault_restoreinput` (script 2158).

**A new item:**

| When | What the server sends |
| --- | --- |
| The tick it's obtained | `collection_count_unsynced` + 1; `New item added to your collection log: <col=ff0000>{name}</col>`; sound 2304; `notification_display` (660) into the notifications slot (161:13) with script 3343 `["Collection Log", "New item:<br><br><col=ffffff>{name}</col>", -1]` |
| 5 ticks later | The total, highscore and tab counts, and the recent items shifted down |
| 13 ticks after the popup opened | The popup is closed |

## Not modelled

- **The Combat Achievements button** on a boss page (621:21); there's no combat achievement system.
- **The burger menu's other slots** (10, 11).
- **The per-item varbits** OSRS sends at login for a few items (`collection_item_*`, e.g. Zulrah's scales) and the `collection_other_*_completed` flags.
- **Loot that doesn't go through `npc-drops:roll` yet:** shops, Barrows, raids chests, clue caskets and others. Each needs a `collection-log:obtain` in a follow-up.
- **"Opened" and "completed" counts** for chests and minigames; they come with those follow-ups.

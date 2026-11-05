# Holiday reward retrieval

Diango's native Holiday-items option opens the existing rareitems_diango interface.
The active cache's enum708 identifies each dynamic child index, and script450 takes
the title plus eight signed unlock masks. It renders and updates real reward icons.
No custom replacement interface, new item IDs or fresh-account unlocks are added.

## Evidence

- RSProx NPC gameval aprilfoolshorsesalesman (Diango8693): Holiday-items op4 in
  revisions229/230/232/237, recordings259,260,2592,2850,2923,3200,3988. Native
  interface78, component78:3 operation flags OP1/OP10 and script450 match this cache.
- Recording232/3200: native slot20 win05_hat1 refuses full inventory on tick+1,
  then successful retrieval adds one on tick0. No fixed artificial action delay is added;
  observed responses span the current/next server tick.
- [OSRS Wiki: Diango](https://oldschool.runescape.wiki/w/Diango): prior unlock needed;
  held, worn and banked rewards are unavailable; house-stored rewards transfer out of
  storage when reclaimed. These ownership rules come from the Wiki, not a rate inference.
- Pinned revision241 dump commit6e5033af6215963581a51b348f452320ff18f0f6:
  rareitems_diango interface78, clientscripts450/474, enum708, NPC8693 options.
  Client catalogue ends at slot227. Alternate forms use cache item_transmog and
  costume-room alternate tables, rather than matching item names.

## Completion contract

Event plugins emit `holiday-rewards:unlock` with `{player,items:[cacheSymbol,...]}`
only after their authoritative completion gate. `accepted` reports validation.
The whole symbol list is checked against the native catalogue before persisting
`holiday-rewards:unlocked`; repeat notifications are idempotent. Player login alone,
owning an item, an active date or opening Diango does not grant completion.
This contract does not itself implement an annual activity or tradeable rares.

## Production path and state owners

Native NPC action -> NPC packet/PluginManager name/action dispatcher -> HolidayRewards
open -> PacketSender main modal/flags/script450 -> native child op1 -> interface dispatcher
-> persisted catalogue entitlement plus current Inventory/Equipment/all real Bank tabs
-> ItemContainer capacity/add -> native refresh. The transient chooser is cleared on
Close, another modal or logout; neither stale clicks nor Examine can mint items.

`construction:costume-retrieve` is handled in Retrieval.Construction.js, using the
same construction:house state key as Data.Construction.js. The shared key is extracted
without changing its spelling/defaults. This stateless owner works even when F2P disables
house entry. The handler transfers from actual costume-furniture storage, checks capacity
and decrements the source before refresh; no foreign holiday handler edits house state.
If a stored item exists, the existing Bank PIN guard protects the transfer. Unlocking the
PIN reopens the chooser; it does not perform a saved stale selection automatically.

The official client only self-hides an exact item already in inventory. Server masks also
exclude banked/worn/cache alternate forms, and every take rechecks ownership after opening.
Metadata-bearing existing items count as owned. Reclaim creates the canonical catalogue
item; it does not duplicate a stored alternate style.

## Verification scope

Tests use actual Player, NPC/cache dispatcher, PacketSender, ItemContainer, Bank,
PlayerHouseInstance/depositHouseItem and PlayerSave/JSON codec. Only network delivery is
captured. Controlled unlock requests and fixture furniture/items are explicitly setup,
not proof that annual events award these items yet. Native rendered integration, independent
review and broader test results must be recorded before publishing this unit.

Independent review found two shared-system defects before publication: the members-only
Construction registration otherwise loses house state on F2P save/load, and the bank search
tab is a stale projection rather than physical ownership. The common house state/default
factory is now registered without enabling house entry; its exact original default shape
and independent room identities are preserved. Ownership scans exclude only the synthetic
search tab. Reviewer reproductions perform actual saved-player hydration and real bank
search/normal-withdrawal/loss; both fail before their fixes and pass afterwards.

First native rendering verified the title, only three fixture-entitled icons, native Take and
Examine, icon removal and empty state after all three takes, Close and reopen with
no duplicates. The NPC route was exercised through MCP npc_option; moving-NPC canvas
right-click attempts did not select him, so browser NPC picking is not claimed here.
Actual inventory contained one Bobble hat6856, Present box hat30479 and Skeleton boots9921.
The existing client showed the Present hat examine text locally without changing inventory.
Temporary Owner-only fixture source was removed; no acquisition/debug command ships.
Own browser closed, game gracefully shut down, static helper stopped, own ports verified
closed and own slot cleared. Independent feature/bank/PIN/bank-space run:124/124 pass.

Comparing that first rendering run with script474 exposed an additional protocol defect:
re-running450 after each take wrongly packed icons, while native474 hides them in place.
The final handler relies on the real inventory-transmit update instead. Exact canonical
inventory items retain their entitlement bit so474 can unhide a lost item; bank/worn and
alternate-form ownership still affect server masks and every take rechecks all owners.
Two encoded-network regressions fail before this correction and pass afterwards. A fresh
reviewer cache VM confirms identity/coordinates survive hide/unhide and reproduces the old
reflow bug. Final native recheck used two fixture hats: Bobble at the first position and
Jester at the next. Taking Bobble hid it while Jester stayed at the same coordinates.
The native Owner clearinv command then simulated loss of that fixture item; Bobble
reappeared in its original position while the modal remained open. No script450 rebuild
was sent. Native Close also worked. This controlled loss is not claimed as a death test.
Final feature/bank/PIN/bank-space tests:126/126 pass. Final-source full server suite:
10,003 pass,6 fail of10,009,0 cancelled,446.37seconds. All six reproduce on untouched
base b6edd9b4a: Belladonna protective harvest, three Farming/Leagues cases, Barronite
task count and bone-burying messages. The full suite is not claimed green.

## Unlocking a held item by using it

Rev 232 recording 3200 shows a player at Diango wearing or playing with holiday items
they held but had never unlocked. Each first Wear or Play-with sent
`You've unlocked a holiday item: <col=ef1020>Tiger toy</col>` (the cache name) and the
item then counted for retrieval; "Check rank" on the Druidic wreath sent no unlock until
it was worn. HolidayRewards follows that: a real equip (`equipment:changed` with
`equipped: true`) unlocks the catalogue entry. `holiday-rewards:used { player, itemId }` is
the same unlock for item handlers whose use counts (such as Play-with); no handler emits it
yet. A catalogue item always unlocks its own entry. An alternate style unlocks its cache
family's entry only when that family holds exactly one entry (the 25th anniversary tabards
share a family but are separate entries). The recording only shows base items, so the
alternate rule is an inference from the shared family.

## Native style chooser (ItemStyles)

`plugins/items/ItemStyles.plugin.js` replaces the Present box hat's single-item chooser.
Any item in the cache `item_transmog` table (bar the two groups below) whose inventory or worn option is Change,
Change-style, Colour, Carve or Paint opens interface `item_transmog` for its group, with
`%item_transmog_active_obj` set and script 6857. An item in two groups (the 2024
Halloween pumpkins) opens its first group from its first style option and its second from
the second: rev 226 recording 1686 shows Colour opening group 9 and Carve group 23.
Selecting a row replaces the item in its own slot, keeps amount and metadata, and sends
`You change the style of your <name before the change>.` (same recording).

The server repeats the client's availability proc (`[proc,script6854]`). Spider hat rows
need their 2023 reward varbits. Treat cauldron rows need the 2022 community-goal stage, a
client varc that only clientscript 2430 sets; nothing sends it, so the client draws them
locked and the server keeps them locked. A style option clicked while another modal (or
this chooser) is open closes it and opens the chooser, as other item actions do.
The greenman mask and Fractured Archive cape groups depend on Forestry and Archive unlocks
this plugin does not own, so they are not opened here.

Tests: `node --test tests/item-styles.test.cjs tests/present-box-hat.test.cjs
tests/holiday-rewards.test.cjs` from `server/` after a build.

## Toy and cosmetic options (HolidayToys)

`server/plugins/items/data/holiday-toys.json` lists each holiday item option with its
cache sequence/spotanim names, sound, overhead text and source; `HolidayToys` plays them
from the inventory or the worn tab (cache worn options, params 451+).

- Recorded (rev 232 recordings 3200 and 3215): the four WWF toys' Play-with (own sequence,
  "Grrrr!"), the Zombie head's Talk-At (`hamlet_head_all`, "Alas!"), and Check rank on the
  Druidic wreath and Mask of balance ("Your tree hugging title is: <col=6f0000>..." from
  `summer_trees_hugged` and the Wiki's 0/15/30/55/75 hug titles). Tree hugging itself
  belonged to the 2014 and 2015 Midsummer events and is not implemented, so nothing writes
  or saves that varbit: Check rank always shows "What's a tree?", as OSRS does for a player
  with no hugs.
- Cache names plus the Wiki: yo-yo Play/Loop/Walk/Crazy with the Wiki's yoyo1-4 sounds,
  marionettes in their colour, Rubber chicken Dance, Haunted wine bottle Wake-ghost, the
  Zombie head's Display overhead (no sequence is known), the Giant easter egg's Easter dance
  (refused in the Wilderness with the Wiki's line), the Book of Egg's Preach, the gingerbread shield's
  green/red/blue Transform cycle and the ugly jumper's Reverse.
- Only the WWF toys' Play-with reports `holiday-rewards:used`, the recorded first-use
  unlock; other toys unlock through Diango's normal routes until a recording shows theirs.
- Overheads have a 6-tick per-player cooldown: recording 3200 replays the tiger's sequence
  on every click but says "Grrrr!" about every 6 ticks. Check rank logs the recorded mesbox
  chat line and shows the message box with its line break. Inventory clicks are accepted
  from both the native `inventory:items` component and the legacy inventory id.

Not yet covered, and why:
- Sounds and timing for everything not recorded; the rubber chicken's Wiki jingle id could
  not be matched to the cache.
- Dialogue-driven options (Zombie head Question, Eek and Haunted bottle Talk-to, Magic egg
  ball, Treat cauldron Check, Santa's list Check, Secret santa present, Archibald Interact)
  need their Wiki transcripts imported as dialogue data rather than written into a plugin.
- Placed items (Wintumber tree, Halloween scarecrow) and the Snow globe's Shake and Snow
  need temporary or POH objects; Cat ears Chase needs Hell-Rat proximity rules.
- Items from the years the annual event plugins implement (Christmas 2025, Halloween 2025
  and the chosen birthday event) are left to those plugins. The Easter 2026 plugin grants
  Archibald; his Interact and the Magic egg ball's Shake are dialogue items (above), and the
  Eastfloor spade's Dig belongs with the Treasure Trails spade handling.

Seasonal rares get no in-game source here. In OSRS, the discontinued rares (partyhats,
Halloween masks, Santa hat and the rest) are not obtainable in game. This server's only
source is the custom `::shops` panel, which a world can switch off with
`"CustomShops": false` in world.json.

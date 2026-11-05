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

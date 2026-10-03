# Construction facilities

This pass adds usable facilities and regression tests to the existing house builder. All room templates, models, furniture previews and storage lists use this project's cache.

## Implemented

1. **Guests and permissions:** use the entrance portal's Friend's house option. Private chat and Ignore settings control entry; locked houses and building mode reject guests. Only owners can edit furniture, configure teleports or deposit/withdraw storage. The owner gets a right-click Kick option on guests while inside their own house. Settings → View House Options (also `::house`) opens native interface 370 for building mode, teleport preferences, doors, expelling guests and leaving. Guests remain when an owner exits; owner logout closes the instance safely.
2. **Portal chambers:** build frames and a teleportation focus, then use Direct-portal. Configuration checks Magic level and consumes 100 casts' worth of inventory runes, after confirmation. Guests can use directed portals without spending runes. Wilderness destinations require confirmation.
3. **Portal nexus:** one room per house, with marble, gilded and crystalline upgrades. Configuration consumes 1,000 casts' worth of runes. Capacity is four, eight, then all supported destinations. Upgrades retain destinations; removing a destination gives no rune refund.
4. **Altars:** prayer restoration, Ancient/Lunar/Dark spellbook toggles, occult upgrades, and bone offerings. Clean marrentill and a tinderbox light incense burners at 30 Firemaking. Each active burner in the same chapel adds 50 percentage points to the altar's Prayer multiplier. Burners expire and their appearance updates for occupants.
5. **Pools:** successive tiers restore special attack; then run energy; then Prayer; then lowered stats excluding Hitpoints; then Hitpoints and poison/venom. Boosts remain intact. Upgrades require the previous pool and actual potion/rune item IDs.
6. **Storage:** all six costume storage categories use native set/member/alternative enums. Use an item on furniture to deposit it, or open/search it to deposit eligible inventory items and withdraw individual items. Capacity and treasure tiers apply. Guests can view only. Upgrades preserve contents; occupied storage and rooms cannot be removed.
7. **Advertisements:** House Advertisement offers Add-House, View and Visit-Last. View opens the native cache interface (52), with sortable host rows, Construction levels, facility columns, Refresh Data and Add/Remove House. The cache scripts handle sorting, filtering and the Enter House action; the server supplies the rows and rechecks entry permissions when selecting a host. Advertisements disappear when the house closes, the owner leaves, the portal locks or building mode starts.

Guest rules follow the [player-owned house reference](https://oldschool.runescape.wiki/w/Player-owned_house). Teleport costs and capacities follow [portal chambers](https://oldschool.runescape.wiki/w/Portal_chamber) and [portal nexus](https://oldschool.runescape.wiki/w/Portal_nexus). Storage rules follow the [costume room reference](https://oldschool.runescape.wiki/w/Costume_room); burner timing follows [incense burners](https://oldschool.runescape.wiki/w/Incense_burner_%28Marble%29).

## House controls

The native House Viewer (422) supports room selection, floor tabs, moving, rotating, deletion with confirmation, and returning to the portal. Adding a room uses the native Room Creation Menu (212). Moves retain furniture, configured destinations and stored items; validation protects the last portal, rooms supporting an upper floor, occupied storage, room counts and house dimensions. Furniture tooltips use the active revision-237 DB slot order.

House teleport spells apply the saved Inside and Default Building Mode preferences after the normal rune costs and teleport animation. Door preferences render solid open/closed doors or remove them and update instance collision for occupants. Entering/leaving clears movement so a kicked guest cannot continue an old house route.

Behavior references: [House Options](https://oldschool.runescape.wiki/w/Options#House_options) and [house planning and limits](https://oldschool.runescape.wiki/w/Player-owned_house#House_planning).

## Current boundaries

- Teleports reuse the server's existing 38 spell destinations. Diary alternatives and destinations absent from that spell system are not added here.
- Nexus and storage management use paginated chatbox menus; their native interfaces, scrying and mounted amulets are not part of this pass. The advertisement board uses its native interface and its 200-house capacity. Houses currently use the Rimmington entrance.
- Offer bones individually by using them on the altar; automatic repeated offerings are not added.
- No servant hiring system exists yet; Call Servant reports that no servant is employed.
- The server has no account-mode, quest-completion or bank-PIN subsystem to enforce the corresponding OSRS restrictions. This pass does not create those systems.

## Verification

Run the server build, then `node --test tests/presets-persistence.test.cjs` from `server`. The suite covers house lifecycle, permission changes after opening a menu, resource costs, saved destinations, storage conservation, upgrades, altar effects, pool tiers rotated nexus models, owner-only kicks without pathfinding, native settings, room moves and deletion safeguards, and door collision changes. The client production build checks compatibility with the existing UI runtime.

In-game follow-up: use two accounts to visit an advertised house, configure and use a portal, upgrade a pool through the furniture interface, light both chapel burners, deposit/withdraw costume items, then leave and reconnect. These live client interactions are manual checks, not claimed by the automated suite.

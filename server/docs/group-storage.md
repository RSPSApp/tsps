# Group storage

`plugins/interface/GroupStorage.plugin.js` (units in `plugins/interface/groupstorage/`) is Group
Ironman's shared bank. It sits behind Grouping's "Group storage" chests (`server/docs/grouping.md`)
and holds one storage per Group Ironman group.

## Sources

- **OSRS Wiki, [Group Ironman Mode](https://oldschool.runescape.wiki/w/Group_Ironman_Mode)**:
  - "Initially, there are 80 bank spaces", unlocked up to 200;
  - "only one player can access it at a time";
  - members' items can't be deposited or taken out on free-to-play worlds;
  - a member who leaves, or is removed, "cannot withdraw items from group storage" during their
    seven days.
- **OSRS Wiki, [Group storage (chest)](https://oldschool.runescape.wiki/w/Group_storage_(chest))**:
  - 13 chests (locs 43487-43499) at the Grand Exchange, Lumbridge, Falador, Ardougne, Catherby,
    Seers' Village, the Tree Gnome Stronghold, Yanille, Port Phasmatys, the Void Knights'
    Outpost, Sophanem, Jatizso and Neitiznot;
  - free-to-play scenery with the one option "Open", and no way back to the personal bank.
- **The cache** (scripts read in the pinned osrs-dumps snapshot, rev 242, checked against this
  cache with `yarn dump:widget 724` and `dump:cs2 5264`):
  - `shared_bank` (724) and `shared_bank_side` (725), listed in full under "The interface" below.
- **No capture uses group storage.** On 12 November 2026 the rsprox database
  (<https://rsprox.net/database>, about 4,300 recordings, through its search API) had:
  - no recording with the 13 chest locs, `gim_bank_chest` (42834), the Group Ironman armour, or
    the varbits `gim_shared_bank_hasedited` (4602), `gim_storage_access_level` (13052) or
    `bank_chest_access` (13677);
  - no message about group storage, and no "is a Group Ironman" trade refusal;
  - only Group Ironman content elsewhere: the Ironman tutor explaining the group modes (3178,
    see `docs/ironman.md`), and The Node's NPCs, the storage tutor among them, seen in passing
    (901, 948, 3467), with no talk.

  The user's own live recordings have none either. The search can't look for interfaces, so a
  recording that opened the storage without changing anything would not show up. Every message
  below marked *ours* waits for a capture, and so does the order of the opening packets, which
  follows the bank's captured opening (script 917, main modal, side modal type 3, slot flags).

## Rules

| Rule | Value | Source |
| --- | --- | --- |
| Who gets in | a Group Ironman (`ironman:mode` is `group`, `group-hardcore` or `group-unranked`) in a Group Ironman group, as the store has it at the click; from a chest, or the bank's Group Storage button (`bankmain:gim_storage` op 1, `popup_button_out` op 2) | Wiki; Grouping |
| New members' limits | what the Group Ironman plugin answers to `group-storage:limit` is shown in %if1, and a Save that takes out more is refused by `group-storage:can-withdraw` (`server/docs/group-ironman.md`) | Wiki (wealth caps) |
| Spaces | 80, and up to 200 as content gives more: `group-storage:capacity` { player, groupId, capacity } is asked at each opening (Group Ironman's storage unlocks); the storage draws that many | Wiki |
| Storage Unlocks | `group-storage:unlocks` { player, groupId, popup, handled } (popup: `shared_bank:popup`); with no answer, "Storage unlocks aren't available on this world" *(ours)*. `group-storage:popup-closed` { player } puts the storage's own %if varps back after a popup used them | Wiki |
| At a time | one member: "<name> is using the group storage." *(ours)* | Wiki |
| Leaving member | "Deposit only" (%if2 = 1); a withdrawal: "You can't take items out of the group storage while you're leaving the group." *(ours)* | Wiki |
| Free-to-play world | members' items can't go in or out: "To use this item please login to a members' world." (the game's line for members' items) | Wiki |
| What goes in | tradeable items only, none with per-item data: "You can't put that in the group storage." *(ours)* | ours: no source lists what it refuses |
| Full | "Your group storage is full." *(ours)* | |
| Group end | a group whose storage holds items can't end: "Empty the group storage first." *(ours)* | ours (the user's choice) |

## Changes are made on copies

The client scripts work on two inventories of their own, and the interface has a Save button and a
"Save and Close" close button. This server works the same way:

1. Opening copies the saved storage into `inv_group_temp` and the backpack into `inv_player_temp`,
   and fingerprints both.
2. Deposits, withdrawals, Shuffle items up and drags change only those copies. The first change
   sets `gim_shared_bank_hasedited`, which makes the close button "Save and Close".
3. **Save**, or **Save and Close**:
   - checks that the real backpack and the saved storage still match their fingerprints;
   - checks that a member with "Deposit only" took nothing out, which covers someone who started
     leaving with the storage open;
   - writes the storage file and the backpack, and requests a player save (`persistence:save`,
     reason `group-storage`).
   If a check fails, nothing is saved. The player is told why, and the copies start again from what
   is really there.
4. **Anything else ends the session without saving:** closing, walking off, logging out, being
   removed from the group, or the group ending. Nothing has moved, so nothing needs undoing.

Player saves run in the background, so the storage file and the player's save aren't written in one
transaction. If the server crashes between the two writes, a deposit could stay in both the storage
and the backpack. That window lasts one save.

## The interface

- `shared_bank_init` reads `%if1` (the wealth-transfer cap left, coins' worth; -1: none shown),
  `%if2` (2 full, 1 deposit only), `%if3` (80 slots) and `%if4` (1 when opened from the bank:
  `main_bank` gets "Back to bank", which saves and reopens the bank). All four are sent before it
  opens; a changed cap is redrawn with cs 5266 `shared_bank_drawcap`.
- The quantity buttons, Withdraw-X, note mode and swap/insert are the bank's own varbits
  (`bank_quantity_type`, `bank_requestedquantity`, `bank_withdrawnotes`, `bank_insertmode`), so the
  storage and the bank share them.
- Item ops are numbered as the cache's draw scripts number them:
  - Withdraw: 1 is the default quantity, 2/3/4 take 1/5/10, 5 takes the remembered X, 6 asks for
    X, 7 takes all, 8 takes all but one, and 10 is Examine.
  - Deposit uses the same numbers, without op 8.
- A noted item is stored unnoted, and comes out noted in note mode. A withdrawal leaves its slot
  empty until "Shuffle items up". Drags swap, or shift the items between in insert mode.
- Search runs in the client. The `countdown` component (`shared_bank_init_timer`, which counts down
  ticks) isn't used: nothing here locks the storage before an update.

## Persistence

`data/saves/group-storage.json` (`TSPS_GROUP_STORAGE_FILE` overrides it) holds every non-empty
storage by group id as `[slot, item, amount]` rows, slots 0 to 199. A storage always shows every
slot that holds something, even past the spaces content gives it. It is written whole at every Save, through a
temporary file. If a group ends with items still stored, its record is kept and marked `ended`, for
an administrator to return. Grouping refuses to end such a group, but a leaver's deposit could still
arrive as the group ends.

## Events

| Event | Direction | What |
| --- | --- | --- |
| `grouping:storage` | handled | `{ player, group, member, handled }`: opens the storage or says why not |
| `grouping:get` | asked | who may still use it, at every click and Save |
| `grouping:can-end` | answered | refuses while the storage holds items |
| `group-storage:limit` | emitted at opening | `{ player, groupId, remaining }`: coins' worth the player may still take out (null: no limit) |
| `group-storage:can-withdraw` | emitted at Save | `{ player, groupId, items, allowed, reason }` with what the Save takes out; `allowed: false` keeps the Save from happening |
| `group-storage:withdrawn` | emitted after Save | `{ player, groupId, items }` |
| `grouping:changed` | listened | re-checks an open session, and ends a disbanded group's storage |
| `interface:closed`, logout | listened | end the session without saving |

Tests: `server/tests/group-storage.test.cjs`.

# Group Ironman

`plugins/modes/GroupIronman.plugin.js` (units in `plugins/modes/groupironman/`) holds Group
Ironman's own rules. It sits on three other plugins and talks to them only through their events:

- **Ironman** (`docs/ironman.md`): the modes `group`, `group-hardcore` and `group-unranked`
  (`ironman` varbit 4, 5, 6; chat icons 41, 42, 43), the trading and loot exceptions for group mates.
- **Grouping** (`server/docs/grouping.md`): the groups themselves, invitations, the 7-day leaving
  and step-down periods, group names.
- **GroupStorage** (`server/docs/group-storage.md`): the shared storage.

Data: `plugins/modes/data/group-ironman.json` (variants, sizes, wealth caps, Hardcore unsafe areas,
every message with its source) and `group-ironman-restricted.json` (prestige-bound items).
Records: `data/saves/group-ironman.json` (`TSPS_GROUP_IRONMAN_FILE` overrides it), one per group
id: `{ groupId, variant, formed, prestige, lives, originals, received }`, plus the leavers whose
choice is still due. A rename never touches it: Grouping's group id is the key.

## Sources

- **OSRS Wiki, [Group Ironman Mode](https://oldschool.runescape.wiki/w/Group_Ironman_Mode)**
  (9 November 2026), [The Node](https://oldschool.runescape.wiki/w/The_Node),
  [Group Ironman tutor](https://oldschool.runescape.wiki/w/Group_Ironman_tutor) (Tony) and
  [Group Storage tutor](https://oldschool.runescape.wiki/w/Group_Storage_tutor) (Maggie).
- **The launch post**, [Update:Group Ironman](https://oldschool.runescape.wiki/w/Update:Group_Ironman)
  (6 October 2021): Hardcore lives, groups of 2 to 5, new members' limits.
- **Tony's and Maggie's transcripts** (`npc-dialogues.json`), which play as they are.
- **The cache** (rev 242, osrs-dumps): the interfaces `gim_leaving` (722), `side_channels_large`
  (727), `gim_sidepanel` (726), `gim_creation_sidepanel` (723), `gim_limited_sidepanel` (721) and
  their scripts; the locs `gim_portal`, `gim_portal_lumbridge`, `gim_bank_chest`, the armour crates.
- **RSProx database**: recording 3178 (rev 232) has the Ironman tutor's line on group trading. No
  capture of The Node, the GIM tab or group storage exists there, so message texts the Wiki and
  transcripts don't give are ours, marked "ours" in the data.

## Group modes and forming (Variants)

| Rule | Value | Source |
| --- | --- | --- |
| A group's mode | its leader's at creation: ranked (Group Ironman), Hardcore or Unranked; members play the same mode, set again at login if the group changed while they were away | Wiki |
| Forming | the leader confirms (the tab's Confirm, or `::gim form`), with at least 2 members; everyone in it then is an original member (Individual Prestige) | Wiki |
| Group Prestige | given at forming, unless the leader opts out (`::gim form noprestige`) or it is Unranked; a Hardcore group always has it | Wiki |
| Before forming | members come and go at once: no leaving period, no step-down wait, and the leader's Cancel ends the group (`grouping:leaving-period` answers false) | Wiki (the group exists once confirmed) |
| Hardcore | takes only Hardcore players while forming, nobody once formed | launch post |
| Unranked | an Unranked Group Ironman joins only Unranked groups; anyone joining one becomes Unranked | Wiki |
| A player who has played before | joining a ranked group makes it Unranked for good; the leader is warned at the first invitation and confirms by inviting again within 2 minutes | Wiki |
| A formed group with prestige taking anyone | loses its prestige; warned and confirmed the same way | Wiki |

"Played before" is `group-ironman:experienced`: set the first time a Group Ironman takes The
Node's portal to the mainland, or picks Ranked after leaving a group.

## Hardcore lives (Hardcore)

A formed Hardcore group has a life per member it was formed with. A member's dangerous death
costs one; so does a death in an activity that is safe for others but not for Hardcore groups
(`hardcoreUnsafeAreas`: matched by the plugin that owns the area), and a member leaving or being
removed. The members online are told. At none the group is a ranked Group Ironman group, its
members Group Ironmen. Not matched yet: the Camelot training room, Lunar Diplomacy's Dream World,
Nightmare Zone and the PvM Arena, which have no area of their own here.

## Leaving a group (Leaving)

When a member's 7 days are over (Grouping's `left` / `kicked`, formed groups only), they choose on
`gim_leaving`: **Ranked** (they lead a new group, every tradeable item they hold, wear or bank is
deleted, and `group-ironman:wipe-tradeables` asks other containers to clear theirs), **Unranked**
(a new Unranked group, items kept) or **Regular** (no longer an Ironman). Each button says
"Select"; a second click on the chosen one confirms. The choice waits, saved, for their next login.

## Unranked by way of Lumbridge (Unranked)

Any Ironman out of a group can become an Unranked Group Ironman at the Ironman tutor in Lumbridge.
It takes effect after 7 days; choosing it again calls it off. On Tutorial Island it is immediate.

## Prestige, wealth caps and restricted items (Wealth, Restrictions)

- **Wealth caps:** a member of a formed ranked group who isn't an original may receive, in all,
  1M coins' worth from the group in their first week, 20M by the end of the second, 50M the third
  and 100M the fourth (Wiki). Counted at Grand Exchange value *(ours)*: trades with group mates
  (checked at each accept, counted at completion) and withdrawals from group storage (checked and
  counted at Save; the storage shows what is left in %if1).
- **Restricted items:** for their first 5 weeks the same member can't equip the listed boss and
  raid uniques until they have killed the source once (a collection log category's kill count
  above 0, or a kill Group Ironman saw). The Gauntlet's own crystal gear is free. Echo boots are
  left out: the list's source for them isn't settled.
- **Group Prestige lost to outside help:** a kill of The Nightmare, Phosani's Nightmare, Nex, the
  Royal Titans or Yama that someone outside the group damaged. The raids are not covered: their
  parties aren't seen here.

## The Node (Node)

The Node is the Group Ironman islands south of Tutorial Island; its NPCs are ordinary spawns.

- **Getting there:** a Group Ironman who finishes Tutorial Island arrives on The Node
  (`tutorial-island:destination`); the portal by Lumbridge's general store (`gim_portal_lumbridge`,
  seen only by Group Ironmen) and the Group ironman helm's Teleport lead there. The Node's portal
  (`gim_portal`) leads to Lumbridge. The arrival tiles, (3095, 3039) beside The Node's portal and (3217, 3233) beside Lumbridge's, are ours, both checked walkable in game.
- **Tony** (Group Ironman tutor): his transcript; "Yes, leave my group." starts leaving; a leader's
  "Rename group." asks for the new name. **Armour** and the armour crates hand out the set of the
  player's mode, the platebody numbered by the group's size (II to V).
- **Maggie** (Group Storage tutor), and the chest beside her: a bank for players who haven't been
  to the mainland yet: "This bank is for new adventurers only, ..." after that.

## The Group Ironman tab (Tab)

For a Group Ironman, SideChannels puts `side_channels_large` (727) in the social tab's side slot
instead of 707; its fifth tab (`tab_gim`, selected value = the `ironman` varbit, 4 to 6) shows what
the plugin answers to `side-channels:gim-tab`:

| State | Interface | What is sent |
| --- | --- | --- |
| In no group | `gim_limited_sidepanel` (721) | cs 5261: "Create Group" only on The Node, and a line saying where groups are formed *(ours)*; clan type 1 cleared |
| In a group still forming | `gim_creation_sidepanel` (723) | varbits `gim_i_am_leader` / `gim_i_am_member`; cs 4448 with up to five member names; cs 4447 with the group's name; op 1 (Kick) on the member rows for the leader |
| In a formed group | `gim_sidepanel` (726) | `gim_affinitystatus` 3, the group as clan type 1: CLANSETTINGS (name, members, owner slot, extra-info bit 28 for originals' prestige star, settings 37 size, 39 prestige, 40 0, 41 lives) and CLANCHANNEL (members online, world 1) |

Buttons: Create Group (`grouping:create`), the group name (an input prompt, then
`grouping:rename`), Confirm (forming), Cancel (`grouping:disband` for the leader,
`grouping:leave` for a member), Kick on a member row (`grouping:kick`). Invite answers "Invite
players with ::group invite <name>." *(ours)*: the cache's Invite is a target button, and the
server has no hook for a component used on a player yet. Every Grouping change and every change to
a group's record (formed, prestige, lives) mounts the tab again for the players it touches.

## Commands

`::gim` (or `::gim info`) says the group's mode, whether it is formed, its prestige and lives, and
the player's own prestige and weekly limit. `::gim form [noprestige]` forms it (the leader).

## Events

| Event | Direction | Payload |
| --- | --- | --- |
| `grouping:changed` | answered | `created`/`joined`: the mode rules; `left`/`kicked`: lives and the leaver's choice; `disbanded`: the record goes; every type: the tab |
| `grouping:can-join` | answered | refuses an invitation or join against the mode rules |
| `grouping:leaving-period` | answered | `period: false` for a group not yet formed |
| `ironman:change-mode` | answered | the Lumbridge Unranked switch |
| `ironman:mode-changed` | answered | the tab again |
| `group-storage:limit`, `:can-withdraw`, `:withdrawn` | answered | the wealth caps |
| `npc-drops:roll` | answered | kills for restricted items; prestige lost to outside help |
| `tutorial-island:destination` | answered | The Node for a Group Ironman |
| `npc-dialogue:choice` | answered | Tony's leave and rename, Maggie's bank |
| `side-channels:gim-tab` | answered | `{ player, tab, group, onMount }` |
| `side-channels:refresh` | emitted | `{ player }` after a change |
| `group-ironman:wipe-tradeables` | emitted | `{ player }` when a leaver picks Ranked |

## Not done yet

- The Node's rowboat (loc 42826) and the inventory wipe when a player first leaves The Node.
- Teleport to House's group options, group chat through clan channel type 1, the Apply option,
  storage unlocks beyond 80 spaces (`shared_bank:storage_unlocks`).
- Prestige lost in the raids, and Hardcore groups' PvM with outsiders.

Tests: `server/tests/group-ironman.test.cjs`, and the GIM frame in `server/tests/chat-channel.test.cjs`.

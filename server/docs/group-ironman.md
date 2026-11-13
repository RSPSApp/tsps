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
members Group Ironmen. Nightmare Zone counts; not matched yet: the Camelot training room, Lunar
Diplomacy's Dream World and the PvM Arena, which have no area of their own here.

## Leaving a group (Leaving)

When a member's 7 days are over (Grouping's `left` / `kicked`, formed groups only), they choose on
`gim_leaving`: **Ranked** (they lead a new group and lose what the Wiki lists, below), **Unranked**
(a new Unranked group, items kept) or **Regular** (no longer an Ironman). Each button says
"Select"; a second click on the chosen one confirms. The choice waits, saved, for their next login.

What a Ranked leaver loses (Wipe; Wiki, Leaving a group):
- in the inventory, worn and in the bank: every tradeable item, reward caskets (scroll boxes stay),
  imbued items, and untradeable forms of tradeable items (an ornament kit's "(or)", degraded
  Barrows "100" to "0") when the item without that mark is tradeable;
- elsewhere, each answering `group-ironman:wipe-tradeables`: what is in a looting bag (the bag
  stays), the rune pouch's runes (the pouch stays), the Nightmare Zone and Last Man Standing coffers,
  and the seed vault.
Storage pouches, the cargo hold, STASH units, the steel key ring and the tool leprechaun keep
theirs, as the Wiki says.

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
  Royal Titans or Yama that someone outside the group damaged; and a raid (Chambers of Xeric,
  Theatre of Blood, Tombs of Amascut, The Fractured Archive) started with anyone outside the group,
  after a warning (Pvm). The raids ask `group-pvm:can-start` { players, activity, allowed, reason,
  confirms } before they start and say `group-pvm:started` { players, activity } after. Warned
  means before anything happens: the first start is refused ("A Group Ironman group here would lose
  its Group Prestige. Start again to go ahead.") and the group told, and a second start within a
  minute goes ahead *(ours)*. Chambers of Xeric asks its own "Begin the raid." question afterwards,
  so it says `confirms` and is only warned; it asks again when Begin is chosen, as players may enter
  while the question is up.
- **Hardcore groups with outsiders:** a Hardcore group must keep its prestige, so a raid its member
  would start with anyone outside the group is refused, and so is walking into Nex's chamber or a
  private Nex instance, The Nightmare's dream or a friend's Royal Titans fight with someone from
  outside the group already there, with a line saying why *(ours)*. Those doors ask the same event
  with `entrant`, and only the entrant is judged, so a Hardcore member inside never locks out
  anyone else. Yama has no duo here, and Phosani's Nightmare is solo.
- **A member's permanent ban** costs a formed group its Group Prestige (Wiki): `::ban` (bans here
  are permanent) says `account:banned` { name }, and Grouping's `grouping:of-account` finds the
  account's groups even while it is offline.
- **Combat achievements:** a Group Ironman isn't asked for tasks that need a bigger team than their
  group (Wiki, Combat Achievements; 1 for a Group Ironman not in a group): CombatAchievements reads
  each task's team from its words ("(Trio)", "(5-Scale)", "in a group of 8") and leaves those tasks'
  points out of the player's tier thresholds, asking `combat-achievements:team-size`.

## Storage unlocks (Unlocks)

The group storage starts with 80 spaces and grows to 200 (Wiki; Update:Group Ironman Improvements,
2 March 2022). The tasks are the cache's: enum 4216 lists 49 structs, each with its bit (param
1289), spaces (1547) and text (1546), 120 spaces in all. `data/group-ironman-unlocks.json` says
what each one asks, by bit: a worn rune platebody or Stronghold boots, a 99 in a set of skills or in
one, 50 to 200 quest points, combat level 50, 100 or 126, total level 500 to 2,000, every diary or
combat achievement task of a tier (the cache has four tiers, Easy to Elite).

- A task counts once a member opens the storage after doing it (GroupStorage asks
  `group-storage:capacity` at each opening), from 5 weeks after the group was formed. The group is
  told *(ours)*; the done tasks are the record's `unlocks`.
- The storage's Storage Unlocks button and the group settings' Group Storage show
  `gim_shared_bank_unlocks` (743) in their popup slot, cs 3127, with %if1/%if2 the done bits,
  %if3 the spaces, %if4 200 and %if5 the weeks to wait.

## Group settings, chat, houses, inviting

- **Group settings** (Settings): the tab's Settings opens `gim_settings` (730), which draws the
  group's name and icons from the clan settings; its rows are the server's (cs 5508 the box at the
  top, cs 5509 one row each as "Label|value|button"): Name (the leader: Change asks for the new
  one), Leader (the leader: Step down picks who leads next, in 7 days once formed; Cancel while
  that runs) and Members (the leader: pick a member, then remove them or keep one being removed).
  Group Storage shows the unlocks; Leave Group / Cancel Leave (by `gim_pending_leave`) leave or
  stay. Hiscores, Options and Raffle say they aren't on this world *(ours)*.
- **Group chat** (Chat; Wiki, Chat Interface: "//// or /g"): the client sends it as clan chat on
  clan type 1; every member online who doesn't ignore the speaker gets it as clan chat (type 41) on
  a channel whose name is a bar and the group's name, which the cache's chat filter (script 5501)
  puts in the Group tab. Clans now leaves clan types other than its own to their content.
- **Teleport to House's Group options** (Houses; the update of 2 March 2022): the spell's "Group:
  Choose" (op4) and "Group: Previous" (op5), and the house tablet's Group, take a Group Ironman to a
  teammate's house. Choose lists the group members online *(ours: a chatbox list)*; Previous goes
  to the last one. SpellTeleports asks `teleports:group-house`; the house's rules (same world,
  not in building mode, open to visitors) are Construction's (`construction:group-house`).
- **Inviting and accepting** (Recruiting): on The Node a leader's right-click Apply (player option
  1, through `player:option-route`) invites another player, who gets live's chat line: chattype
  111 "Form group" while the group forms, 112 "Group with" once formed (rebuildchatbox, which draws a
  line's text after its first "|" (script632), so ours leads with one; the text is ours). The client sends that line's option as player option 1 on the inviter (chat_op_core:
  opplayer(1, name)), which is Apply back, and Grouping takes it as the answer to their invitation.
  The creation panel's Invite is a target button (the use-on-player flag, the click coming back as
  `magic:spell-on-player`); the group panel's Invite turns the leader's Inviting on or off
  (`gim_invitationstatus`), which Apply needs once the group is formed *(ours)*.
- **No command needed:** forming (Create Group, Confirm), naming, inviting and accepting, removing
  a member (the creation panel's Kick; the settings' Members), stepping down and cancelling it,
  leaving and cancelling a leave (the settings, or Tony), ending a group still forming (Cancel) and
  the storage (chests, the bank's Group Storage button) all go through live's interfaces and NPCs.
  `::group` and `::gim` are extras.

## The Node (Node)

The Node is the Group Ironman islands south of Tutorial Island; its NPCs are ordinary spawns.

- **Getting there:** a Group Ironman who finishes Tutorial Island arrives on The Node
  (`tutorial-island:destination`); the portal by Lumbridge's general store (`gim_portal_lumbridge`,
  seen only by Group Ironmen), the rowboat at Tutorial Island's south end (`gim_boat`, Travel) and
  the Group ironman helm's Teleport lead there, each asking first as other teleports do
  (`TeleportHandler.confirm`). The Node's portal
  (`gim_portal`) leads to Lumbridge. A Group Ironman still on the tutorial takes the rowboat after the
  Ironman tutor and never sees the Magic Instructor (Wiki: Tutorial Island), so the crossing ends the
  tutorial (`tutorial-island:leave`), whose destination is The Node; anyone else at the boat is told
  "Only Group Ironmen can cross over to The Node. If you wish to become a Group Ironman, speak to the
  Ironman tutor north-east of here." (Learning the Ropes' transcript). The arrival tiles, (3095, 3039) beside The Node's portal and (3217, 3236) in front of Lumbridge's, are ours: Lumbridge's portal (3216,3235, 4 wide) is set in a wall along y 3234, and its open side faces north, towards the general store.
- **Leaving without a group:** a Group Ironman with no formed group (none, or one still forming)
  chooses another game mode at The Node's portal before it takes them (Update:Group Ironman: "you
  can just leave The Node without a group. You'll need to choose between the other game modes before
  being teleported to the mainland."): Ironman, Hardcore, Ultimate or none, or staying. A group still
  forming is left first (refused, as any leave, while its storage holds items). *Ours:* the prompt's
  wording.
- **Tony** (Group Ironman tutor): his transcript; "Yes, leave my group." starts leaving; a leader's
  "Rename group." asks for the new name.
- **Armour** (Armour): Tony's Armour hands out what the player lacks of the cache's set for their mode
  (ranked, Hardcore, or the "(unranked)" set), the platebody numbered by the group's size (II to V; the
  cache has no I, so a player alone gets II *(ours, the user's choice)*). Adam in Lumbridge hands out
  the same set (`ironman:armour`). A numbered platebody that doesn't match the group's size crumbles as
  it is equipped (Wiki): "The platebody crumbles to dust as you attempt to equip it. You can get a new
  one from an Ironman tutor."
- **The armour crates** (Armour crate, Hardcore armour crate; Take): the crate of the player's own mode
  hands out its set (the Armour crate serves Unranked players too). The other crate changes the
  player's Group Iron mode to its own, only before the mainland: after it, Tony says "You can only
  change your Group Iron mode if you haven't been to the mainland." (his transcript, at the crates).
  That the crates change the mode is Tony's line and Update:Group Ironman ("going to the Hardcore
  Armour Crate (found on The Node, east of the statue) should allow you to re-select Hardcore").
  *Ours:* the question first
  ("Become a Hardcore Group Ironman?"), "Leave your group first." for a member of a group,
  "An Unranked Group Ironman can't change their Group Iron mode.", and that the other modes' armour
  (carried, worn or banked) crumbles when the mode changes ("The armour of your old Group Iron mode
  crumbles to dust.").
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
`grouping:leave` for a member), Kick on a member row (`grouping:kick`), Invite (see Inviting),
Settings (the group settings) and Refresh. Every Grouping change and every change to a group's
record (formed, prestige, lives, unlocks) mounts the tab again for the players it touches.

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
| `group-storage:capacity`, `:unlocks` | answered | the storage's spaces after this opening's unlocks; its Storage Unlocks button |
| `group-storage:popup-closed` | emitted | `{ player }` when the unlocks close over the storage |
| `group-pvm:can-start`, `group-pvm:started` | answered | Hardcore groups refused (`entrant`: only them), prestige warned of and lost |
| `account:banned` | answered | a member's ban costs the group its prestige |
| `combat-achievements:team-size` | answered | the group's size (1 without a group) |
| `teleports:group-house` | answered | whose house Teleport to House's Group options go to |
| `magic:spell-on-player` | answered | the creation panel's Invite used on a player |
| `npc-drops:roll` | answered | kills for restricted items; prestige lost to outside help |
| `tutorial-island:destination` | answered | The Node for a Group Ironman |
| `ironman:armour` | answered | `{ player, items }`: Adam's set for a Group Ironman, numbered for their group |
| `tutorial-island:leave` | emitted | `{ player, handled }` by the rowboat: ends the tutorial for a player still on it |
| `npc-dialogue:choice` | answered | Tony's leave and rename, Maggie's bank |
| `side-channels:gim-tab` | answered | `{ player, tab, group, onMount }` |
| `side-channels:refresh` | emitted | `{ player }` after a change |
| `group-ironman:wipe-tradeables` | emitted | `{ player }` when a leaver picks Ranked |

## Not done yet

- The Camelot training room, Lunar Diplomacy's Dream World and the PvM Arena as unsafe for
  Hardcore groups: they have no area of their own here.
- The group settings' Hiscores, Options and Raffle; the members' Switch world; group chat for
  RuneLite through the gateway (it is clan chat there).
- A Ranked leaver's items in Death's item retrieval, and in a costume room (none here).
- The storage locking 10 minutes before an update, the Ring of Life for Hardcore groups, the
  handegg's line, Echo boots in the restricted items, and Tony's options for creating a group or
  stepping down (the tab and `::group promote` do those).

Tests: `server/tests/group-ironman.test.cjs`; the GIM frame in `server/tests/chat-channel.test.cjs`; the
house's Group options in `server/tests/teleport-tablet-destinations.test.cjs` and
`server/tests/house-portals.test.cjs`; PvP experience in `server/tests/ironman.test.cjs`.

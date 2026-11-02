# Friends chat and player following

The [OSRS chat-channel page](https://oldschool.runescape.wiki/w/Chat-channel) documents the slash-prefixed channel messages, owner-controlled entry/talk/kick ranks, ignore-based entry blocking, temporary 60-minute kick bans, and 500-member capacity. It also says a channel reset when empty clears those bans. The implementation follows those rules in `FriendsChatManager`; its saved player fields retain the channel name, three access ranks, friend ranks, and last joined owner. `player-save.test.cjs` covers that save/load round-trip, which also supplies the offline-owner profile path used on automatic rejoin.

The [player page](https://oldschool.runescape.wiki/w/New_character) lists Follow among a player's right-click options. It does not describe follow movement or teleport/logout cleanup. In this server, follow is a transient `Mobile` reference: ordinary movement interactions clear it through `MovementQueue.walkToReset`, known player actions clear it as they dispatch, logout clears the departing player's reference, and `Mobile` clears follow-owned interaction/facing state before a player relocation. These cleanup paths are implementation behavior covered by local tests; they are not independently verified against live OSRS. The movement tick also drops a follow when its target is no longer registered or is in another private area.

Presence is single-world: friend snapshots resolve currently registered players in this server's `World` and send world 1 for visible online friends. Cross-world presence and the live OSRS behavior of the right-click Follow action's edge cases remain outside this implementation.

## The chat-channel against live

Text, message types and timing come from rsprox recordings (rev 227-238), covered by `tests/chat-channel.test.cjs`:

- **Joining:** "Attempting to join chat-channel..." at once, the answer a tick later (763). Asking while already in a channel gets "Please wait until you are logged out of your previous chat-channel." (3266). The rejoin at login shows the same lines (763). Plugin and bot joins are immediate.
- **Setup:** enabling a disabled channel is immediate, says "Your chat-channel has now been enabled!" and how to join, and doesn't join it (749, 754). While a channel is on, name, rank and disable changes are saved at once and reach the channel 100 ticks after the first one, with one notice for that window (type 30; 754). Until then the channel keeps its old setup, even empty, so a join in the meantime gets it (753). Friends and ignores apply at once; no capture shows otherwise.
- **Disabling:** when the delay ends the owner gets "Your chat-channel has now been disabled!" and members "You have been removed from this channel." (754).
- **Refusals** are type 11 notifications. No capture holds the talk rank refusal, the kick refusals or the full-channel text, so those are ours.
- **Attacking:** nothing stops a player attacking someone in their channel; no recording or Wiki page shows such a rule, and the attack option "right-click for clanmates" assumes they can be attacked. Bots are still held back from their own channel, which is ours, for recruits.

## The social tab

The tab is the cache's tab bar `side_channels` (707) with its content in 707:7, as live mounts it (4186). A click on 707:2-5 sets varbit 13071 and mounts 7, 701 (Your Clan), 702 (Guest Clan) or 76 (Grouping) (2528; rev 227's buttons sit one component later, 75). The choice is saved. `SideChannels.plugin.js` does this; a plugin that needs the first tab, like the Chambers of Xeric party (500), uses `side-channels:replace-chat-channel`. That the first tab keeps showing the party when clicked is an assumption.

The Clan system isn't implemented. Login sends varbits 933 and 12164 = 1, so both clan tabs say "No current clan" (script 4288), and typing `//` gets the client script's own refusal. In Grouping, the activity list works in the client, while its Teleport button and PvP Arena have no server side: no capture shows what they send.

## Public chat and autochat

Public chat arrives as the CHAT packet (kind byte 0 public, 1 game, 2 friends chat, 3 public autochat) and
goes out as a CHAT_MESSAGE of type 2 to every local player whose public filter admits the speaker
(`PlayerRelations.canReceivePublicChatFrom`; the Public stone's modes 0 Show standard, 1 Show friends,
2 Show none, 3 Hide, 4 Show autochat), plus the overhead line.

Autochat is the [Chat Interface](https://oldschool.runescape.wiki/w/Chat_Interface) "Setup your autochat"
option and lives in the cache scripts: the phrase sits in varcstring 358, "Pause/Resume autochat" flips
varcint 62, and the chatbox timer (proc 552) forces the public filter to mode 4 and calls
`chat_sendpublic(text, 1)` every 150 client cycles (3 seconds). The client sends kind 3 for type 1, the
server flags the social packet `public_chat` with `autoChat` and delivers it as type 90 (AUTOTYPER, or 91
MODAUTOTYPER with a mod crown) so the chatbox colours it as "Auto chat". The cache chatbox shows those lines
only in mode 4 "Show autochat" (beside standard chat), so the server sends autochat only to listeners on
mode 4. The overhead text is still the plain forced chat; the public filter does not hide it.

## Reporting a player

As captured (rsprox 2375 rev 229, 3719 rev 235), every player has "Report" in player option slot 8.
That option, or the chatbox Report button (`chatbox:reportabuse` 162:31, op 2 "Report abuse"), makes
the server send varbit `chatoverlay_unclamp` (10689) = 1, open interface 875 `reportabuse` as an overlay
on `chatbox:chatoverlay` (162:567 in the rev 241 cache; 162:565 in the captures) and run `reportabuse_init`
(5084) with [enabled, hasName, name]; the
form's Close (875:23) sends the varbit back to 0, closes the overlay and runs `reportabuse_close` (5085).
A busy player is told "Please finish what you're doing first." (the message a capture shows for the
button's bug-report op). `ReportAbuse.plugin.js` does all of this.

The form's submit is `chat_sendabusereport(name, rule, mute)`, which the client sends as REPORT_ABUSE
(client packet 199, OSRS SEND_SNAPSHOT: name, rule id one less than the script's value, mute flag). The
server appends `{ time, reporter, reported, ruleId, rule, mute }` to `data/saves/abuse-reports.jsonl`
(`TSPS_ABUSE_REPORTS_FILE` overrides the path), emits the `report:abuse` custom event, and sends nothing
back: the form shows its own confirmation. `mute` is recorded only when a staff member asked for it, and
is not applied. No capture holds a submitted report, so the lack of a reply is an assumption.


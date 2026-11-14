# Wilderness obelisks

Plugin: `server/plugins/areas/WildernessObelisks.plugin.js`, data
`server/plugins/areas/data/wilderness-obelisks.json`.

## The six Wilderness obelisks

From rsprox captures (recording 3886, rev 235) and the OSRS Wiki (Wilderness_Obelisk):
Activate sends everyone on the 3x3 pad to a random obelisk, Teleport to Destination to the one
the player set. Set Destination (hard Wilderness Diary) opens menu 187; the choice is varbit
`wilderness_portal_choice` (sub + 1). The stones glow, smoke at 7 ticks, the portal shows at 11
and the teleport happens at 13.

## The house obelisk (superior garden)

`poh_wilderness_obelisk` (31554), from rsprox captures (recording 2884, rev 230, ticks
5582-6180) and the Wiki (Obelisk_(Construction)):

- Its options are lower case: Activate, Teleport to destination, Set destination.
- It takes only its user (the Wiki says it "individually teleports players"). There's no stone
  animation and the destination's stones don't change.
- Every option that teleports first shows the Wilderness warning screen (475). The server sets
  varbit `cws_warning_id` to 7, hides the "Don't ask me this again" toggle (475:13) and sets
  the text on 475:10. "Enter Wilderness" resumes 475:1 with sub 1 and "Don't go" with sub 0
  (clientscript 1437).
- Enter Wilderness: `human_wilderness_portal` (3945) plays at once. Two ticks later the player
  gets the spam line "Ancient magic teleports you to a place within the wilderness!" (for
  Activate too), lands on a tile of the destination's pad, and the animation resets.
- Activate picks a random obelisk: the recording landed on level 44's pad (2980,3867) while
  level 35 was set. Teleport to destination uses the choice saved by Set destination, the same
  one the Wilderness obelisks use; the recording landed on level 13's pad (3157,3619).
- Set destination and Teleport to destination need the hard Wilderness Diary, as at the
  Wilderness obelisks.

Leaving the house goes through `construction:exit-house` (House.Construction.js), which uses the
house's own `exitHouse`, as the portal nexus does.

Ours (no capture): the refusals without the diary or without a destination reuse the Wilderness
obelisks' lines. Teleport checks (busy, Tele Block) run on the click and again on Enter.

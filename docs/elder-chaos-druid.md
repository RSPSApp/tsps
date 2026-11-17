# Elder Chaos druids

The level 129 mages at the Wilderness Chaos Temple
(`server/plugins/npcs/ElderChaosDruid.plugin.js`, tests in
`server/tests/elder-chaos-druid.test.cjs` and `server/tests/tele-block.test.cjs`).

## Attacks

Wind Wave and Tele Block, with the animations, projectiles, sounds and recast rule from rsprox
captures (recordings 435, 437, 438). The values are listed in the plugin's header comment.

## The pull

From the [Wiki](https://oldschool.runescape.wiki/w/Elder_Chaos_druid) and
[its transcript](https://oldschool.runescape.wiki/w/Transcript:Elder_Chaos_druid). None of the
five recordings with these druids (435, 437, 438, 724, 821) shows a pull or the line.

- The druid teleports a fleeing player to within melee distance and says
  **"You dare run from us!"** overhead.
- The pull reaches 20 tiles (Mod Ash, 19 July 2021, cited on the Wiki).
- It pulls the fleeing player who has done the druid the most damage first, even while the druid
  is attacking someone else. It never pulls a player who is attacking it.
- A read teleport anchoring scroll stops it. The scroll belongs to issue 6013. The druid emits
  `combat:npc-teleports-player` with `{ npc, player, destination, blocked: false }` before it
  moves the player, and a listener that sets `blocked` stops the pull.

Ours (no source covers these):

- A fleeing player has damaged the druid within the damage cache timeout, attacks nothing, stands
  outside the four tiles beside the druid, and is walking or running.
- The pull takes the druid's attack turn (4 ticks). A druid with no target then fights the player
  it pulled.
- It needs a clear line for a spell, and lands on the free tile beside the druid that is nearest
  the player. With no free tile there is no pull.
- No animation, graphic or sound plays: no source shows one.

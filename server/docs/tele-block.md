# Tele Block

The effect on the target (`TeleBlock.ts`, `plugins/combat/TeleBlock.plugin.js`) and the Elder
Chaos druid that casts it (`plugins/npcs/ElderChaosDruid.plugin.js`).

## Confirmed facts

Sources: the OSRS Wiki pages Teleport Block and Elder Chaos druid (`https://oldschool.runescape.wiki/w/Teleport_Block`,
`https://oldschool.runescape.wiki/w/Elder_Chaos_druid`) and rsprox recordings 435, 437 and 438 (revision 232).

- Duration 5 minutes, halved to 2 minutes 30 seconds when Protect from Magic is up as the spell lands (Wiki; the
  recordings show both messages).
- The target is told at the cast: `A Tele Block spell has been cast on you by an Elder Chaos druid. It will expire in
  5 minutes.` (purple), and 30 seconds before the end `Your Tele Block will expire in 30 seconds.` (recordings 435, 437).
- A teleport attempt while blocked says `A teleport block has been cast on you. It should wear off in 1 minute, 27
  seconds.` with the time left (recording 435, a ring teleport).
- The Ferox Enclave barrier turns a blocked player away with `You are currently teleblocked, it would be too dangerous
  to allow you into the Enclave.` (recording 435).
- The block is removed when the player leaves the Wilderness (Wiki, April 2024 hotfix). The Ferox Enclave and its buffer
  are PvP-tagged ground, so a blocked player stays blocked at the barrier.
- Logging out ends the block (Wiki, Teleport Block: 23 August 2018 update, "The effects of Tele Block now expire upon
  logging out."), so the save holds no Tele Block and a login never restores one (`PlayerSave`). Logging out needs the
  player out of combat, as for any logout.
- Elder Chaos druid: magic, max hit 17, attack speed 4 (Wiki). Wind Wave plays sequence 11429, graphic 158 at height 92
  and projectile 159 (start 32, end 32 + 10 a tile, at least 60). Tele Block plays sequence 1819, projectile 1299 (start
  30, end 69 at any distance), graphic 345 on the target and sounds 202 and 203. A druid cast a new block when none was
  running or the running one had 10, 16 or 18 ticks left; casts at 236 ticks left changed nothing.

## Not covered

- The druid teleporting a fleeing player (Wiki only, no recording), and the teleport anchoring scroll that stops it.
- Casts a druid makes at an already blocked target (they play the animation and do nothing); how often it picks
  Tele Block is not in the recordings.
- Immunity after expiry: the recordings count 100 ticks past the end, but no recording shows a player cast in it.
- An expiry message: none was recorded.

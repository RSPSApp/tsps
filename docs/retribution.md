# Retribution

The overhead prayer (46 Prayer). Plugin: `server/plugins/combat/Retribution.plugin.js`; tests:
`server/tests/retribution.test.cjs`.

## What happens when the wearer dies

- It is set off by the `player:dying` event, so any death counts: another player, an NPC, a hazard.
- It does not go off when the killing blow was reflected damage (Vengeance, a ring of recoil, another
  Retribution; `HitDamage.markReflected`), or when it was a failed pickpocket's stun
  ([OSRS Wiki: Retribution](https://oldschool.runescape.wiki/w/Retribution)). A death from Retribution
  damage therefore cannot chain.
- Content can veto a death with `retribution:trigger` (`{ player, hit, allow }`); the pickpocket
  plugin uses it for the stun.
- The damage is a roll of 0 to a quarter of the wearer's base Prayer level, rounded down (the Wiki
  table: 11 at levels 46-48 up to 24 at 96-99), so 0 is possible and drained points do not matter.
- Everything on the eight tiles around the wearer that they could attack is hit: attackable NPCs,
  and other players in areas where the wearer may attack players. Duelling players are left alone.

## What live OSRS showed

rsprox capture 1754 (revision 227, a Leagues world; the only recording in which `retribution_spotanim` appears):

- The tick after the wearer's Hitpoints reached 0 they played `retribution_spotanim` (437, delay 30)
  and area sound 159 (radius 5) played on their tile.
- One `retfirebreath_travel` (438) projectile flew from the wearer's tile to each of the eight
  surrounding tiles, cycle 36 to 48, slope 0, progress 0, height 23 at both ends. Nothing was sent
  for tiles farther away, so the reach is the adjacent tiles, not a wider radius.
- The death animation followed two ticks later.

The capture has no NPC or player standing next to the wearer, so it does not show a hitsplat. That
NPCs are hurt is from the Wiki ("nearby enemies", and its note that NPCs killed by Retribution give no
Achievement Diary kill credit).

## Choices not shown by a capture

- The hits are queued to arrive with the projectile (two ticks), for whoever then stands on the
  tiles. The Wiki says the projectiles were made faster "to make it harder to avoid", which reads as
  dodgeable.
- Multi-combat is not required; the Wiki does not mention it.
- The Chaos Fanatic exception the Wiki lists is not implemented.

Before this, the prayer only hit a player killer within three tiles, played just the graphic, and did
nothing when an NPC killed the wearer.

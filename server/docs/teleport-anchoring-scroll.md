# Teleport anchoring scroll

The [teleport anchoring scroll](https://oldschool.runescape.wiki/w/Teleport_anchoring_scroll) (29455)
is a one-time Read unlock persisted as `teleport-anchoring:unlocked`, with client varbit 10672
synchronized on login. The confirmation and completion messages follow rsprox recording 444
(rev 233).

This implementation currently protects against the player-displacing attack of an
[Abyssal demon](https://oldschool.runescape.wiki/w/Abyssal_Demon).
On an accurate hit by a player, including a zero-damage hit, it rolls the demon's self-teleport at
1/6 first; only on failure does it roll the player teleport at 1/3. The local recordings show the
demon animation 2309, graphic 409 and moves up to three tiles. Landing tiles here are randomly
chosen from reachable tiles within that observed local range. The exact retail landing distribution
has not been established. On a successful player teleport, the player's combat is cleared.

Elder Chaos druid teleports are not implemented yet. The published [druid behavior](https://oldschool.runescape.wiki/w/Elder_Chaos_druid)
is a pull toward melee range, with the fleeing player's damage ranking affecting target choice and
players attacking the druid being exempt. The indexed recordings available for this fix did not
establish a reliable pull trigger or target-selection sequence, so the handler does not claim to
protect against that attack. The scroll's client dialogue retains the canonical text that names both
monsters.

The protection does not cover the Abyssal Sire, Greater Abyssal demons, Tele Block, or other forms
of teleport denial.

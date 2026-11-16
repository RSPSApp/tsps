# Teleport anchoring scroll

The [teleport anchoring scroll](https://oldschool.runescape.wiki/w/Teleport_anchoring_scroll) (29455)
is a one-time Read unlock persisted as `teleport-anchoring:unlocked`, with client varbit 10672
synchronized on login. The confirmation and completion messages follow rsprox recording 444
(rev 233).

The scroll protects against the player-displacing attack of an
[Abyssal demon](https://oldschool.runescape.wiki/w/Abyssal_Demon).
On an accurate hit by a player, including a zero-damage hit, it rolls the demon's self-teleport at
1/6 first; only on failure does it roll the player teleport at 1/3. The local recordings show the
demon animation 2309, graphic 409 and short moves. The demon selects a reachable tile within
three tiles. Player displacement can reach twenty tiles, as documented by the Wiki; the exact
retail landing distribution is unknown. A player teleport clears combat.

The saved unlock also vetoes the [Elder Chaos druid pull](../../docs/elder-chaos-druid.md) before
the druid moves the player. Cancel closes the confirmation without consuming the scroll.
Accepting it plays sequence 7403 and sound 2655, as in recording 444.

The protection does not cover the Abyssal Sire, Greater Abyssal demons, Tele Block, or other forms
of teleport denial.

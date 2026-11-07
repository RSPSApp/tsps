# Scorching bow: Scorching shackles

The [Scorching bow](https://oldschool.runescape.wiki/w/Scorching_bow) special attack
(`server/plugins/combat/specials/ScorchingBow.SpecialAttack.js`) costs 25% special energy.

- **Demons** (NPCs with the cache `demon` attribute): the target is bound for 20 ticks (12 seconds)
  whether or not anything is "hit", takes 1 burn damage at once and 1 more every 4 ticks, 5 in
  all. The swing fires no arrow and rolls no hit.
- **Anything else** (other NPCs, players): the special is refused with "Scorching shackles won't
  work against a non-demon enemy.", no energy is spent and the swing is an ordinary shot.

The burn goes through the shared `combat:burn` event, so the burn immunities of the Burns plugin
apply: a target that cannot burn is still bound but takes none of the five damage.

## Evidence

- Wiki (fetched 7 November 2026): 25% energy, demons only, the refusal message, a 20-tick bind that
  applies "regardless of whether it is a successful hit or not", 1 burn damage on use then 1 every
  4 ticks, 5 in total.
- rsprox captures of the special swing, all on Leagues or event worlds (recordings **572**,
  **1756**, **1762** on Leagues V, **3315** on a Grid Master event world): the player plays
  `human_weapon_bow_scorched_01_spec` with `vfx_human_scorching_bow_special_attack_01`, the target
  gets `vfx_scorching_bow_impact_01` after the `vfx_scorching_bow_projectile` flight, special energy
  drops by 25%, `sa_attack` returns to 0, and no hit or ordinary arrow is sent on that tick. The
  non-demon refusal message appears in recording 3315 with energy untouched and an ordinary arrow
  fired. The ids match the rev 241 cache (animation 11133, spotanims 2806/2807/2908).
- Burn hitsplat timing is taken from the Wiki and the shared Burns plugin, not from a capture.

## Not covered

- The target's `vfx_scorching_bow_spotanim` (a second graphic on slot 5 in the captures) is not
  drawn: graphics have one slot here, so only the impact graphic is shown.
- Sound ids 9325-9328 and their delays are taken from the captures; their volume is unverified.
- Whether the special swing uses ammunition was not visible in the captures; none is used.

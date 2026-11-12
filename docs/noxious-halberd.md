# Noxious halberd: Virulence

`server/plugins/combat/specials/NoxiousHalberd.SpecialAttack.js`. Test:
`server/tests/noxious-halberd-special.test.cjs`.

Virulence is a utility special: it resolves on the special-bar press, with no target and no
swing (`skipAttack`).

## Live behaviour

From the [Noxious halberd](https://oldschool.runescape.wiki/w/Noxious_halberd) page and
RSProx recording 1449 (revision 224, the only capture of the special):

- It costs 50% special energy and is usable only while poisoned or envenomed. Pressed without
  an affliction, the game message is "You can only use this special attack whilst you are
  poisoned." and nothing is spent (the recording shows the energy only regenerating).
- Used while poisoned, the player plays `human_halberd_virulence_02` with the
  `vfx_noxious_halberd_spec` spotanim, energy drops by 50% and the `poison` varp goes to 0 on
  the same tick. Poison is cured with no immunity afterwards (Wiki).
- Wiki: "The player's next accurate attack with the halberd will have its minimum hit increased
  by the damage the player would have taken from their cured affliction", e.g. 16 poison damage
  cured gives a damage roll between 16 and the max hit. "This effect is lost if the player
  changes weapon or logs out."

## How it is built

- The cured damage is what the next tick would have dealt: venom stores its damage directly, and
  poison stores a severity that `CombatPoisonEffect.damageFromSeverity` turns into damage.
- It is kept in the `noxious-halberd:virulence-minimum-hit` player attribute. It is not
  persisted, so a logout loses it, and `equipment:changed` clears it when the halberd is no
  longer wielded (swapping away and back does not restore it).
- `combat:hit-rolled` fires only for accurate hits, so a miss keeps the bonus. The next accurate
  melee roll with the halberd that is below the stored value is re-rolled uniformly between the
  stored value (capped at that roll's maximum) and the maximum, so the hit is uniform on
  [floor, max] rather than piling onto the floor; a roll already at or above it is kept. The
  bonus is spent either way.

## Not done

- Wiki sounds 9403 (buildup) and 9404 (impact) are not played: recording 1449 shows no sound at
  the press, so the timing is unknown (see [special-attack-sounds.md](special-attack-sounds.md)).
- The Last Man Standing halberd items (33178, 33179) are separate items and are not covered.

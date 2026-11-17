# Dorgeshuun weapon specials

Backstab (bone dagger) and Snipe (Dorgeshuun crossbow), in
`server/plugins/combat/specials/`, and the crossbow's ammunition
(`server/src/main/typescript/elvarg/game/content/combat/ranged/RangedData.ts`). No packet
capture shows these weapons or bone bolts, so everything here is from the OSRS Wiki.

## Backstab and Snipe

From the [Bone dagger](https://oldschool.runescape.wiki/w/Bone_dagger) and
[Dorgeshuun crossbow](https://oldschool.runescape.wiki/w/Dorgeshuun_crossbow) pages:

- Both cost 75% special energy.
- Both "will never miss as long as the target has not been damaged previously", or when the
  last player to damage the target was someone else. The specials declare the
  `guaranteedHitOnUnsuspectingTarget` trait; the hit roll skips accuracy unless the attacker
  is the target's `Combat.getLastDamager()`: the player whose damage was recorded last, while
  the target's damage record still counts them (a disengaged fight clears it). A hit of 0
  damages nothing, so it doesn't make the attacker the last damager.
- Both lower the target's Defence by the damage dealt, players and NPCs alike, and only when
  its Defence is at (or above) its base level: "The defence lowering is only applied when the
  target doesn't currently have their defence levels lowered." Mod Ash, cited on the bone
  dagger page: "they'll only try to reduce it if it's on (or above) its base level at the
  time." Players stop at 1 Defence, NPCs at 0, as the other Defence-draining specials do.

## The crossbow's ammunition

The Dorgeshuun crossbow "can fire metal bolts up to iron, except silver bolts, and is the only
crossbow that can use bone bolts", and not "bolts containing unique tips and their (e)
variants" (Dorgeshuun crossbow page). So it fires bronze, blurite, iron and bone bolts.
[Bone bolts](https://oldschool.runescape.wiki/w/Bone_bolts) "can only be used with the
Dorgeshuun crossbow" and have +49 Ranged Strength. Their projectile is the cache's
`dttd_bone_crossbowbolt_travel` spotanim (696).

## Not done

- The Wiki says Backstab "can only be used after completion" of Death to the Dorgeshuun, and
  Snipe needs the quest too. No source gives the message shown without it, so the specials
  aren't gated on the quest.
- The cache has `dttd_bone_crossbowbolt_travel_sp_attack` (698), presumably Snipe's own bolt.
  No capture shows Snipe, so it fires the ordinary bone bolt projectile.

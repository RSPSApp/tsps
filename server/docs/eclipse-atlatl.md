# Eclipse atlatl combat support

## Rules and sources

- [Eclipse atlatl](https://oldschool.runescape.wiki/w/Eclipse_atlatl),
  [Atlatl dart](https://oldschool.runescape.wiki/w/Atlatl_dart), and
  [Burn](https://oldschool.runescape.wiki/w/Burn).
- Normal damage formula and Slayer/Salve treatment: the
  [Wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc/blob/main/src/lib/PlayerVsNPCCalc.ts).
- IDs checked against local cache revision 241, `osrs-241_2026-10-20`.
  Readable reference: [osrs-dumps at 6e5033af6215963581a51b348f452320ff18f0f6](https://github.com/Joshua-F/osrs-dumps/tree/6e5033af6215963581a51b348f452320ff18f0f6).
- Projectile packets: public OSRS RSProx recordings
  [4014](https://rsprox.net/download/4014) and [4021](https://rsprox.net/download/4021), revision 237.

## Findings and changes

The weapon and its ammunition were absent from the ranged registry. Combat could fall back
to melee behavior: the wrong animation/sound and no ammunition consumption. Registration now
covers the regular weapon/darts (29000/28991) and LMS weapon/darts (29851/29852).
Each uses its own dart type, consumes ammunition through the normal recovery/drop rules,
and rejects arrows, bolts and an empty ammunition slot. The weapon itself is not ammunition.

Normal attacks use animation 11057 and projectile 2795, with impact graphic 2796.
The configured projectile settings are launch cycle 41, heights 163 to 146, angle 15 and
progress 11. The existing bow flight formula is retained. Attack range is 6, or 8 on
Longrange. Rapid takes 3 ticks against NPCs, 4 against players without the full set,
and 3 against players wearing the full set. Other stances retain their usual extra tick.
The weapon targets **standard** ranged defence, despite throwing darts.

Normal damage uses visible Strength and melee strength equipment, with Ranged prayers and
the Ranged stance bonus. Ranged level/equipment still determine accuracy. Ranger Void applies
to damage; melee Void does not. Slayer helmets/black masks and Salve amulets use their melee
damage bonuses without stacking. Their accuracy bonuses keep their existing ranged rules.
The cache's 75 Ranged, 50 Attack and 50 Strength equipment requirements remain unchanged.

The special costs 50%, requires all three functional Eclipse armour pieces, works without
darts, and has melee reach. It rolls Magic accuracy with a 1.5 multiplier and deals Magic
damage. It retains the weapon's Strength-based/Ranged-prayer base damage, then adds remaining
burn damage to its maximum and half, rounded down, to its minimum (maximum bonus 50).
This interpretation follows the Wiki's weapon-wide damage rules; the Wiki DPS calculator
does not independently implement the special as a formula oracle.
The attack consumes the burns when launched, including when its accuracy roll subsequently
fails. Intact, degraded and LMS armour variants qualify; broken pieces do not.
Special animation/graphics remain the cache's 11060, 2797 and 2798.

The full-set effect gives accurate normal hits a 20% chance to add a strong burn. Burns share
one tracker with Burning claws and Arkan blade: at most five independent-duration stacks,
one damage per stack every four ticks, ten damage over forty ticks per normal-length stack.
An additional burn cannot replace or refresh a full stack. Damage is displayed together with
the burn hitsplat. It respects NPC ranged damage reductions and burn immunity, bypasses
player protection prayers, and does not trigger another attack's ammunition, XP, poison,
Smite, recoil, retaliation or skulling. Damage credit stays with each burn's source.
Death/logout, an ornate pool and entering/leaving a player-owned house clear the status.
Sailing creatures provide their immunity through a query; birds are exempt.

## Verification limits

- Normal launch audio currently uses the existing dart-throw sound (2696) rather than the
  melee fallback. The Wiki does not specify its synth ID. The projectile settings reference
  the recordings above;
  the local normal launch sound has not been independently verified.
  **Exact launch-sound parity remains unverified.** Special sounds are supplied by cache
  animation/graphic sequences; no duplicate manual sound is added.
- Scorching bow has no registered special in this checkout. The shared tracker accepts its
  five-damage burns, but implementing that separate weapon's missing special is outside this fix.
- This update does not add Eclipse armour degradation/repair mechanics.
- Verification results for the TSPS integration are recorded in the pull request. The focused
  regressions cover cache IDs, formula choices, ammunition, special attacks and burn lifecycle.

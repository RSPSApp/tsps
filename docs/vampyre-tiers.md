# Vampyre damage tiers

Implemented in `server/plugins/combat/effects/Vampyrebane.EquipmentEffects.js` (melee and ranged hit and accuracy modifiers, keyed on the NPC's cache name and the Wiki `vampyre` attribute).

## Sources

Wiki pages read for this: https://oldschool.runescape.wiki/w/Vampyre, https://oldschool.runescape.wiki/w/Vampyrebane_weapons, https://oldschool.runescape.wiki/w/Silver_weaponry, https://oldschool.runescape.wiki/w/Efaritay%27s_aid, https://oldschool.runescape.wiki/w/Vyrewatch.
The osrs-captures index only holds Vyrewatch Sentinel attacks from one Leagues recording (560), so there is no main-game capture of an immune hit.

## Rules

| Tier | NPCs | Damage taken |
| --- | --- | --- |
| 1 | Feral vampyre, vampyre juvenile | Every weapon, full damage. Silverlight and Darklight add 10%. |
| 2 | Vampyre juvinate | Silver weapons, silver bolts and the tier 3 weapons only. Anything else deals 0. |
| 3 | Vyrewatch, Vyrewatch Sentinel, venator, blood-starved venator, ancient feral vyre | Blisterwood sickle, Ivandis flail, blisterwood flail, hallowed flail, sunspear and blisterwood stake only (their existing accuracy and damage bonuses). Silver does not count. |

Efaritay's aid (ring slot): tier 1 gets +10% damage from every weapon and +15% accuracy for silver weapons; tier 2 non-silver weapons deal half damage, silver and tier 3 weapons get +15% accuracy and +10% damage; tier 3 weapons get +15% accuracy and +10% damage (regular weapons still deal 0).

## Choices and limits

- Blisterwood sickle (e) keeps its bonus but, as the Wiki lists it among the tier 2 weapons, deals 0 to tier 3.
- Poisoned silver bolts count as silver bolts (the Temple Trekking data this replaces treated them so); the Wiki lists only "Silver bolts".
- Only the melee and ranged max-hit and accuracy modifiers are tiered. Spells, the cannon, thralls, recoil, Vengeance and special attacks or fixed hits that skip those modifiers are not changed at any tier: the Wiki says nothing about them for tiers 2 and 3.
- Area hits judge each victim by its own tier, not by the attacker's primary target: Dinh's bulwark Shield Bash, chinchompas, barrages, scythe of Vitur cleaves and Venator bow bounces.
- Temple Trekking juvinates used to take 0 from every player hit (spells included); spells now hit them for full damage, like any other vampyre.
- Hits from NPCs (the Temple Trekking follower) are not affected.
- Tier by name: NPCs not named above with the `vampyre` attribute count as tier 1. The juvenile/juvinate retreat-into-mist mechanic is not implemented.
- Temple Trekking juvinates used their own silver check (any Efaritay's aid wearer dealt full damage); they now follow these tiers.

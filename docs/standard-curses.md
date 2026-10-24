# Standard stat-draining curses

All six standard stat curses apply their existing player behavior to NPCs through
the real per-NPC level API. Their former core implementations had no active NPC path.
Gameplay now lives in StandardCurses.plugin.js; spell cost, accuracy, XP, animation,
graphics, spellbook and membership metadata retain their existing definitions.

| Spell | Relevant level | Reduction |
| --- | --- | --- |
| Confuse | Attack | 5% |
| Weaken | Strength | 5% |
| Curse | Defence | 5% |
| Vulnerability | Defence | 10% |
| Enfeeble | Strength | 10% |
| Stun | Attack | 10% |

An accurate impact subtracts the floor of that percentage of the current level. A
relevant level already below its normal maximum rejects another curse; unrelated
drained levels do not block it. NPC definition data is unchanged. Encounter-owned stat
immunity and natural restoration remain enforced by NPC.setCurrentLevels/getCurrentLevel.
The existing player rounding is retained, not presented as independently captured OSRS
rounding at every level boundary.

The six spells explicitly declare zero direct damage. Generic magic maximum calculation
now recognizes explicit zero instead of replacing it with the old fallback of one.
CombatEffectSpell accepts optional maximum metadata while retaining the existing negative
sentinel for unspecified spells. Binding-spell damage is a separate audit: the current
Snare page's infobox and the original Wiki calculator/general spell table disagree.

## Generic utility impact dispatch

CombatEffectSpell checks accuracy before applying an impact. Its public spellEffect path
then dispatches two custom events with the actual attacker, target and spell, and mutable
allowed/handled fields:

1. magic:utility-effect-check lets policy veto or take ownership before any effect.
2. magic:utility-effect lets a plugin handle the effect; unhandled spells retain their
   legacy callback. An earlier veto prevents both plugin and legacy effects.

The Standard Curses plugin respects earlier handling and uses the impact spell rather
than the attacker's subsequently selected spell.

## Primary sources and validation

The [standard spellbook](https://oldschool.runescape.wiki/w/Standard_spellbook),
[Confuse](https://oldschool.runescape.wiki/w/Confuse),
[Weaken](https://oldschool.runescape.wiki/w/Weaken),
[Curse](https://oldschool.runescape.wiki/w/Curse),
[Vulnerability](https://oldschool.runescape.wiki/w/Vulnerability),
[Enfeeble](https://oldschool.runescape.wiki/w/Enfeeble) and
[Stun](https://oldschool.runescape.wiki/w/Stun) establish the percentages and no-stacking
behavior. No other private server is used as a source.

Real Player/NPC regressions reproduce all six missing NPC effects before the repair and
cover player equivalence, misses, zero damage, no stacking, unrelated levels, encounter
immunity, restoration, fractional rounding, boosted players, actual impact-spell context,
prior veto/ownership and unrelated legacy fallback. Tome of Water's additional effects
remain the next independent implementation, not part of this claim.

Native packet verification on the isolated game world confirmed all six effects on
canonical lesser demons: Attack68→65/62, Strength70→67/63 and Defence71→68/64 for the
5%/10% pairs. A real normal Duke encounter was opened and awakened using poison items;
Confuse changed its Attack300→285 while Strength345 and Defence275 stayed unchanged.
These are observed server levels after actual spell packets. QA left combat, saved and
logged out, then the isolated world shut down cleanly.

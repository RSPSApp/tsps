# Brimstone ring

The brimstone ring's passive magic effect and its creation from the three Hydra parts.

- The effect is `server/plugins/combat/effects/BrimstoneRing.EquipmentEffects.js`. The core
  raises the generic `combat:magic-defence-roll` custom event (`attacker`, `target`, `spell`,
  mutable `defenceRoll`) from `AccuracyFormulasDpsCalc.specialRolls` whenever a magic attack rolls
  against magic defence. Results must be finite and nonnegative, or the unmodified roll is kept.
- The creation is `server/plugins/items/BrimstoneRing.plugin.js`.
- The ring's bonuses (+4 to every attack, defence and melee strength bonus, +6 magic attack and
  defence) were already right in the item data.

## Sources

- [Brimstone ring](https://oldschool.runescape.wiki/w/Brimstone_ring) (fetched for this page): a
  worn ring gives a 25% chance, each time the player attacks with a spell or magical attack (powered
  staves included), that the target's defensive roll is reduced by 10% for that attack; the chatbox
  then says "Your attack ignored 10% of your opponent's magic defence." in red; barrage and other
  multi-target attacks affect only the single target the player selected.
- [Hydra's eye](https://oldschool.runescape.wiki/w/Hydra%27s_eye) and its transcript
  ([Transcript](https://oldschool.runescape.wiki/w/Transcript:Hydra%27s_eye)) (fetched for this
  page): using the eye, fang and heart on each other warns that it cannot be reversed, asks to
  proceed or cancel, and on proceed says the three were combined into the Brimstone Ring.
- rsprox capture 1534 (revision 224): a Magic attack with the ring worn, with the message
  `<col=ff0000>Your attack ignored 10% of your opponent's magic defence.</col>` arriving as a
  `spam` (filterable) game message on the same tick as the cast animation (`human_castwave_staff`).
  It is the only capture of the effect; the 25% chance and the 10% are the Wiki's.

## Behaviour

| Step | Behaviour |
| --- | --- |
| Magic attack, ring worn | One 25% decision per attack tick for the target the player attacks. On a proc the defence roll is `floor(roll * 90 / 100)` and the spam message is sent; further rolls on that tick reuse the decision and say nothing again. |
| Other targets of the cast | Unchanged (the decision applies only to the player's chosen target). |
| Ranged and melee attacks, other rings | Unchanged. |
| Hydra's eye, fang and heart used on each other, all three carried | A box with the warning (the Wiki transcript's text), then "Select an option": "Proceed with the combination." / "Cancel.". Nothing is consumed until Proceed. |
| Proceed | The three parts become the brimstone ring and an item box shows "You successfully combine the Hydra Heart, the Hydra Eye, and the Hydra Fang into the Brimstone Ring." Cancel closes the menu. |
| A part is missing | The use is left unhandled (this server sends no message for an unhandled item-on-item). |
| Preset or otherwise restricted copies | Never consumed; "Preset items cannot be used for this." |

## Limitations

- No capture of the creation exists, so its timing is immediate and its text is the Wiki
  transcript's.
- The Wiki's rule that a player gets no duplicate Hydra part until holding all three is a
  drop-table matter and was not examined or changed here.

## Tests

`server/tests/brimstone-ring.test.cjs`: the proc and its message through the real
`rollAccuracy`, one decision per tick, the chosen target only, ring and style gating, and the
creation flow.

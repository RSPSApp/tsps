# Gadderhammer

Plugin: `server/plugins/combat/effects/Gadderhammer.EquipmentEffects.js`, attached by
`EquipmentEffects.plugin.js`.

Source: <https://oldschool.runescape.wiki/w/Gadderhammer> and
<https://oldschool.runescape.wiki/w/Shade_(attribute)>.

## Behaviour

Against a shade, each gadderhammer hit has a 1 in 20 chance of dealing double damage and
otherwise deals 25% more. The bonus is applied to the max hit as a melee hit modifier (the way the
keris scales against kalphites), rounded down, so it multiplies with a salve amulet (e) and Void
Knight equipment: the Wiki says the bonus stacks with both, citing a Jagex developer's post.

A shade is a monster with the Wiki's `shade` attribute, already in `monsters-complete.json`:
Loar, Phrin, Riyl, Asyn, Fiyr and Urium Shade. The Wiki lists the Catacombs of Kourend and
Stronghold of Security shades and the Temple Trekking shades as not vulnerable; they carry no
`shade` attribute here.

## Not covered

The Wiki says the hammer cannot be wielded until Gadderanks is defeated in In Aid of the
Myreque. It is currently wieldable by anyone. The refusal text is not in any capture or on the
Wiki page, so it is not added to the quest equipment list. The generated Attack 30 requirement in
`item-gameplay.json` also differs from the Wiki's "no combat requirements"; that file is generated.
No rsprox recording covers the hammer.

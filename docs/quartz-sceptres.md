# Quartz sceptres

The Desert Treasure II quartzes (blood, ice, smoke, shadow) upgrade the ancient sceptre
(`server/plugins/items/QuartzSceptres.plugin.js`). The sceptres' passives live in
`AncientSceptre.plugin.js`.

## Combining (rsprox captures)

Recording 821 (rev 234), ticks 1641-1645, uses a blood quartz on an ancient sceptre:

| tick | what live sent |
| ---: | --- |
| +0 | `objectbox_double` with the quartz (model1) and the sceptre (model2): "Are you sure you wish to combine the Blood quartz and Ancient sceptre to create a Blood ancient sceptre?" |
| +2 | `chatmenu` "Combine the Blood quartz and Ancient sceptre?" with "Yes." / "No." |
| +3 (Yes) | seq 10096 (`human_xbow_enchant_arrowtip_walkmerge`), spotanim 759, synth 140; the clicked sceptre's slot (1) empties and the clicked quartz's slot (7) holds the Blood ancient sceptre; `objectbox` with the new sceptre: "You successfully combine the Blood quartz and Ancient sceptre to create a Blood ancient sceptre." |

The Ice, Smoke and Shadow quartzes use the same lines with their own names (Wiki:
[Ancient sceptre](https://oldschool.runescape.wiki/w/Ancient_sceptre), Quartz upgrades).

## Dismantle

The Wiki says the upgrade can be reversed, and the cache gives each unlocked quartz sceptre a
Dismantle option. No capture shows it. Ours: it swaps the sceptre for the ancient sceptre in
the same slot and adds the quartz, with no message. It needs one free slot and otherwise says
"You don't have enough inventory space to dismantle your sceptre." (the Thammaron's sceptre
line).

## Not modelled

- The locked (l) sceptres: their combining isn't recorded.
- Ours: the sceptre used on the quartz is assumed to leave the result in the quartz's slot too.
  Rec 821 only shows the quartz used on the sceptre (T1641 `selectedsub=7`, T1644 slot 7).
- A refusal line for the Wiki's Desert Treasure II requirement: none is recorded, so without
  the quest the pair is left unhandled ("Nothing interesting happens."), as the ancient ring
  chisel does.

# Dragon hunter lance

Creating the Dragon hunter lance from the Alchemical Hydra's claw. The code is
`server/plugins/items/DragonHunterLance.plugin.js`. The lance's dragonbane effect is
`server/plugins/combat/effects/DragonHunter.EquipmentEffects.js`.

## Behaviour

- A Hydra's claw used on a Zamorakian hasta (or the hasta on the claw) opens a box showing both
  items (hasta on the left, claw on the right): "Are you sure you wish to combine the Hydra claw and
  the Zamorakian hasta to create the Dragon hunter lance? This cannot be reversed."
- Its continue opens "Select an option" with "Proceed with the alchemical combination." and
  "Cancel.". Cancel closes the menu and keeps both items.
- One tick after Proceed, the lance takes the claw's inventory slot, the hasta's slot empties, the
  player plays sequence 4462 (`human_xbow_enchant_arrowtip`) with spotanim 759
  (`xbows_enchanting_tips_spot`) and sound 140, and a box shows the lance: "You successfully combine
  the Hydra claw and the Zamorakian hasta to create the Dragon hunter lance."
- The items are checked again at that tick, so nothing is consumed if either has left the inventory.
- No skill level is checked (the Wiki names none). Noted, preset, untradeable or unbankable copies don't combine.
- The claw on any other spear or hasta (Zamorakian spear, iron spear) isn't handled by this plugin.

## Sources

- rsprox capture 1532 (revision 224), ticks 94-103: the claw (slot 8) used on the hasta (slot 14),
  the mesbox chat line and objectbox_double (model1 hasta, model2 claw), the chatmenu at tick 97,
  Proceed at tick 99, and at tick 100 the success mesbox, spotanim 759, sequence 4462, synth sound
  140, the lance in slot 8, slot 14 emptied and objectbox 193 with the lance. The same recording
  and recording 1529 show the claw on an iron spear and on a Zamorakian spear answering "Nothing
  interesting happens.".
- [Dragon hunter lance](https://oldschool.runescape.wiki/w/Dragon_hunter_lance): made by using a
  hydra claw on a Zamorakian hasta, with a warning that it can't be reversed and a confirmation to
  proceed with the alchemical combination; the success line matches the capture. It names no skill
  requirement for the combination (78 Attack is to wield the lance).

## Not covered

- Only the claw-on-hasta order is captured. With the hasta used on the claw the lance still goes
  in the claw's slot (ours).
- Live answers the claw on another spear with "Nothing interesting happens."; ours says nothing,
  because the core has no fallback message for an unhandled item-on-item use (any pair, not just
  this one). That fallback is a separate engine change.
- Live keeps the menu up after Proceed until the success box replaces it one tick later. Ours
  closes it on the click, so the chatbox is empty for that tick, because `MultiChatboxPrompt` always
  closes before it runs an option's callback.

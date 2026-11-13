# Soulreaper axe components

`server/plugins/items/SoulreaperAxe.plugin.js`. The four Desert Treasure II boss uniques (Executioner's
axe head from Vardorvis, Eye of the Duke from Duke Sucellus, Siren's staff from the Whisperer, Leviathan's
lure from the Leviathan) and how they become the Soulreaper axe (28338). The axe's combat (soul stacks,
Behead) is in `combat/specials/SoulreaperAxe.SpecialAttack.js`.

## What live does (rsprox captures)

Recording 1754 (rev 227):

- **Inspect** (ticks 3734-3739): an object box with the item and its line, also logged in the chatbox as
  `type=mesbox`:
  - axe head: "It's the head of Vardorvis' axe. You might be able to combine it with something else."
  - eye: "It's one of Duke Sucellus' many eyes. You might be able to combine it with something else."
  - staff: "It's a staff taken from the Whisperer. You might be able to combine it with something else."
  - lure: "It's the lure of the Leviathan. You might be able to combine it with something else."
- **Head on eye, all four components, no blood runes** (tick 3741): a plain message box (and mesbox
  line) "Assembling those items will require the power of 2,000 blood runes."
- **Head on eye with 2,000 blood runes** (ticks 4090-4096): straight to the chat menu "Create a
  Soulreaper axe?" / "Yes." / "No.". On Yes, the same tick: the four components and all 2,000 runes go,
  the axe takes the first free slot (the lure's), animation `human_xbow_enchant_arrowtip_walkmerge`,
  spotanim `xbows_enchanting_tips_spot`, sounds 140 and 1613, a Magic XP update, and an object box with
  the axe: "You successfully assemble the four components into a Soulreaper axe."

## Wiki

- Transcript:Executioner's axe head: with fewer than four components, "You don't have enough
  components to make anything useful. It looks like you'll need four separate components."; the blood
  runes must be in the inventory.
- Soulreaper axe, Creation: 75 Magic (not boostable), 400 Magic XP.

## Ours

- The 75 Magic refusal's wording, and checking it after the components and runes (no source has it).

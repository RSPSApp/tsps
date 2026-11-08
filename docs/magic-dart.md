# Magic Dart and the Slayer's staff (e)

`server/plugins/items/SlayersStaff.plugin.js` holds the rules the standard-spellbook Magic Dart and the
Slayer's staff (e) share. The spell itself (animation, projectile, 30 XP, 4 mind and 1 death rune) is
`CombatSpells.MAGIC_DART`.

## Verified

Source: the OSRS Wiki pages for [Magic Dart](https://oldschool.runescape.wiki/w/Magic_Dart),
[Slayer's staff (e)](https://oldschool.runescape.wiki/w/Slayer%27s_staff_(e)) and
[Slayer's enchantment](https://oldschool.runescape.wiki/w/Slayer%27s_enchantment). No rsprox recording of the
spell was found (the recordings indexed under its spellbook component are other spells), so none is cited.

- **Requirements:** 50 Magic and 55 Slayer to cast, with a Slayer's staff, Slayer's staff (e), Staff of the
  dead, Toxic staff of the dead, Staff of light or Staff of balance wielded. Before this change only the plain
  Slayer's staff worked, and Slayer was not checked.
- **Maximum hit:** `floor(Magic / 10) + 10` (table: 15 at 50-59 Magic, 19 at 90-99, 20 above 99). Before this
  change it was a flat 19.
- **Slayer's staff (e):** against the player's assigned monster the maximum hit is `floor(Magic / 6) + 13`
  (the Wiki's staff page table: 25 at 75 Magic, 31 at 108). The Magic Dart page's text writes the same
  formula with a typo; its table agrees with this one.
- **Charges:** the staff holds 2,500; each Magic Dart hit on the assigned monster spends one, misses and other
  targets spend none, and an empty staff reverts to a Slayer's staff.
- **Enchanting:** a Slayer's enchantment used on a Slayer's staff makes a Slayer's staff (e) with 2,500
  charges. The enchantment already appears in the NPC drop tables.

## Not covered

- The Wiki gives no message for casting without a qualifying staff or with too little Slayer. The generic
  "You do not have the required equipment to cast this spell." and "You need a Slayer level of 55 to cast this
  spell." are ours, not captured.
- Autocasting Magic Dart from the Staff of the dead, Toxic staff of the dead, Staff of light and Staff of balance
  needs the client's autocast list for those staves (cache script 2098 and 243 pick it from varp 664), which
  was not examined here.
- The Wiki says splashed casts keep the green projectile with the (e) staff; the white projectile with the
  staff (e) is not modelled.

# Runecrafting altars

Crafting runes at the runic altars (`server/plugins/skills/Runecrafting.plugin.js`). Guardians of
the Rift crafts its own guardian essence through the `runecrafting:altar-rune` event and is
described in [guardians-of-the-rift.md](guardians-of-the-rift.md).

## What an altar binds

- One click converts all the essence in the inventory
  ([Wiki: Runecraft](https://oldschool.runescape.wiki/w/Runecraft)). At the altars that take rune
  essence (air, mind, water, earth, fire, body) rune and pure essence are crafted together, at the
  same XP and runes per essence.
- The other altars take pure essence only. Without it the true Blood Altar refuses in a message
  box: "You do not have any pure essences to bind." (rsprox capture 1636). Only that altar's
  refusal is captured; the server uses the same box at every pure essence altar.
- The Wrath Altar (loc 34772, `wrath_altar`) crafts wrath runes from pure essence at 95
  Runecraft, 8 XP an essence, with no multiple runes
  ([Wiki: Wrath Altar](https://oldschool.runescape.wiki/w/Wrath_Altar),
  [Wiki: Wrath rune](https://oldschool.runescape.wiki/w/Wrath_rune)).
- The true Blood Altar (loc 43479) takes pure essence at 77 Runecraft, 10.5 XP an essence
  ([Wiki: Blood Altar](https://oldschool.runescape.wiki/w/Blood_Altar)).
- Kourend's Blood Altar (loc 27978, Bind) takes dark essence fragments, never pure essence: 77
  Runecraft, 23.8 XP and one blood rune a fragment
  ([Wiki: Blood Altar (Kourend)](https://oldschool.runescape.wiki/w/Blood_Altar_(Kourend)),
  [Wiki: Blood rune](https://oldschool.runescape.wiki/w/Blood_rune)). With nothing to bind it
  says "You have nothing suitable to bind." in a message box (rsprox capture 1673).

## The Ourania Altar

The Ourania Altar (loc 29631, `rc_zmi_dungeon_cracked_center_altar`) in the Ourania Cave
([Wiki: Ourania Altar](https://oldschool.runescape.wiki/w/Ourania_Altar)):

- It needs no Runecraft level and binds every pure and daeyalt essence, never rune essence.
  Each essence becomes one rune, rolled out of 10,000 on the Wiki's table for the player's level
  bracket (`plugins/skills/data/ourania-altar.json`); there are no level multiples.
- The XP is 1.7 times the crafted rune's base XP, and 1.5 times that for daeyalt essence. The
  base XP is the normal altars' (soul 11, blood 10.5); with it the table gives the Wiki's XP per
  essence for every bracket.
- With the medium Ardougne Diary done, each rune has a chance of an extra one (25% for air
  through astral, down to 10% for soul) and no extra XP.
- Messages (rsprox captures 819, 822): "You bind the temple's power into runes." as spam, then,
  with the diary, "Your medium level knowledge of the local area allows you to bind additional
  runes." Without essence: "You do not have any pure or daeyalt essences to bind." in a message
  box. The craft's animation, graphic and sound are the other altars'. Both recordings are Grid
  Master event worlds, so their rune amounts and un-noting are not used.
- The rift guardian rolls once per essence at the altar's own base, 1,487,213, whatever the rune
  ([Wiki: Rift guardian](https://oldschool.runescape.wiki/w/Rift_guardian)); the rune made still sets its colour.

## The craft

On the click (or on arrival): sequence `human_runecraft` (791), spotanim `runecrafting` (186) at
height 92, sound 2710 (rsprox capture 1693, crafting at the water and mind altars in Guardians
of the Rift).

## Raiments of the Eye

Worn Hat of the Eye, Robe top of the Eye, Robe bottoms of the Eye and Boots of the Eye (in any
dye, by equipment slot and cache name) add runes to an altar craft (`Raiments.Runecrafting.js`;
Wiki: [Raiments of the Eye](https://oldschool.runescape.wiki/w/Raiments_of_the_Eye), [Ourania
Altar](https://oldschool.runescape.wiki/w/Ourania_Altar)).

- With R runes made before the bonus and M of 1, 2, 3 or 6 for one to four pieces (10% a piece and
  20% more for the full set, 60% in all), the bonus is `floor(R / 10) * M`; when 10 does not divide
  R it is one more `M` with the remainder's chance. The Wiki says only "a chance based on the
  remainder", so the chance is `(R mod 10) / 10`, which makes the average `R * M / 10`. The Wiki's
  example: 28 runes with one piece give 2 or 3 bonus runes, with the full set 12 or 18.
- The bonus runes give no XP (Wiki). They count toward the diary tasks that craft a number of
  runes at once (the Wiki's diary tables): the event carries them as `bonusRunes`, and `runeAmount`
  is the total.
- The Ourania Altar applies the same bonus to each colour it makes (Wiki: the full set boosts the
  runes "in the same way" as at regular altars). The Wiki gives no separate rule for partial sets
  there.
- No recording shows an altar crafted in the outfit on a main-game world (the Hat of the Eye
  recordings, rev 227, are Leagues), so this rests on the Wiki.

## Ruins, portals and tiaras

- A worn tiara (or the Runecraft cape) shows Enter on the ruins; it takes the player in at once with
  sound 200 and "You feel a powerful force take hold of you..." as spam (rsprox captures 1549,
  1632, 1636).
- A talisman used on the ruins is held up first (rsprox captures 1636, 1757, 1840, 1850): a tick
  after the click `human_pickupfloor`, sound 200, varbit `busy` on and "You hold the <talisman>
  towards the mysterious ruins.<br>You feel a powerful force take hold of you..." as spam (the
  blood talisman is "Blood Talisman" there); two ticks later the teleport and `busy` off.
- Landing tiles are the captured ones: water (2725, 4832), earth (2657, 4830) and fire
  (2576, 4848) (rsprox captures 90, 91, 1549, 1757, 1858; `runecrafting-ruins.json` `destination`).
- An altar's exit portal: the teleport outside its ruins, sound 200 and "You step through the
  portal..." as spam, on the click. The Blood Altar's (loc 43478) leads to (3559, 9780) (rsprox
  capture 1636).
- Tiaras: the talisman or a tiara used on its altar with both in the inventory makes the tiara,
  with "You bind the power of the talisman into your Tiara." as spam and no animation (rsprox
  capture 1636). XP is the Wiki's (Tiara: 25 for air up to 52.5 for blood and wrath); the one
  captured drop (+32 for a blood tiara) is not used.
- The essence-mine wizards (rsprox captures 1628, 2280): the wizard says "Senventior Disthine
  Molenko!" overhead and casts Curse (108 on them, projectile 109 from 61 to 100 cycles, 110 on the
  player, area sounds 127 and 126), and the player lands in the mine four ticks later. Live's
  mine is an instance with several landing tiles; here it is the fixed mine and its middle.

## Not done yet

- The Raiments of the Eye's extra runes in the Guardians of the Rift altars, in combination rune
  crafting and with the abyssal lantern: none is covered (no source checked for how the outfit
  applies there).
- Daeyalt essence (pure essence's runes at 1.5 times the XP) needs the Daeyalt essence mine.
- Dark essence fragments come from the Dense essence mine, the Dark Altar and a chisel, none of
  which exist here yet; the Soul Altar has no handler.
- The Wrath Altar's Dragon Slayer II requirement and the true Blood Altar's Sins of the Father
  requirement: no capture of the refusal.
- Combination runes (captured: mud and lava runes, rev 227) and the Ourania Altar.
- The level and rune essence refusals ("You need a Runecrafting level of at least # to craft
  this.", "You don't have any essence in your inventory.") have no capture.

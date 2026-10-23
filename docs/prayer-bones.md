# Prayer: bones, restore and the bonecrusher

## Bones

`server/plugins/skills/data/bones.json` lists every bone Prayer handles, by obj gameval:

| Field | Meaning | Source |
| --- | --- | --- |
| `xp` | burying experience | each bone's OSRS Wiki page |
| `restore` | Prayer points given back in the Catacombs of Kourend or with a dragonbone necklace | Wiki, Dragonbone necklace (Catacombs page: bones 1, big bones 2, dragon bones 4) |
| `bonemeal` | the pot the Ectofuntus grinder fills | Wiki, Bonemeal |
| `crush: false` | the bonecrusher leaves it (tertiary drops: long and curved bones) | Wiki, Bonecrusher |
| `level` | Prayer needed to bury or worship with it (superior dragon bones, 70) | Wiki |

The `bonemeal` list holds the worship experience per pot (four times the bones'). tsps experience is
whole, so tenths round up, as the old table did (bones 4.5 → 5, bat bones 5.3 → 6).

The core's `ArceuusOfferings.BONE_XP` (Sinister Offering, Construction altars) is separate and
unchanged.

### Local sequential burial convenience

For this private installation, **Bury** starts with the clicked bone, then continues through
eligible unnoted bones in inventory slot order, including mixed types. Each bone resolves after
two game ticks; consumption and experience happen together. Nonbones, members-only bones on a
free world, and bones above the player's Prayer level are left alone. Movement, another item
action, logout/death or an enabled level-up popup stops the sequence without consuming its
unresolved bone. This automatic continuation is a user-requested local convenience; it does not
change ash scattering, bonecrusher rewards or altar offerings.

## Demonic ashes

`server/plugins/skills/data/ashes.json` lists the ashes that demons drop instead of bones, by obj gameval.
Their inventory option is **Scatter** (the item's first option in the cache), handled by the same
Prayer plugin. Unlike burying, a scatter resolves on the tick it is clicked: the ash is consumed, the
experience given, "You scatter the ashes." sent, and the player plays seq 2295
(`farming_ingredient_sprinkle`) with synth 2444 (`farming_sprinkle`), all at once and with no
spotanim. Ashes restore no Prayer, cannot be offered at altars, and the members-only ones are refused
on free worlds by `FreeToPlay` through the item's members flag, so the data holds only the experience.

| Ashes | `xp` (scattering) | Members | Source (Wiki, Remains) |
| --- | --- | --- | --- |
| Fiendish ashes | 10 | no | imps, fiends |
| Vile ashes | 25 | no | hellhounds and others |
| Malicious ashes | 65 | yes | black demons and others |
| Abyssal ashes | 85 | yes | abyssal demons, Abyssal Sire |
| Infernal ashes | 110 | yes | Cerberus, K'ril Tsutsaroth, Skotizo, Tormented Demons, Zalcano |

Captured from live OSRS (rsprox.net recordings 2123, revision 227, and 3013, revision 231): each
Scatter click on an ash (`IF_BUTTON2`/`IF_BUTTONX` on the inventory) is answered on the next server
tick, in one batch, by the game message "You scatter the ashes." (chat type 105), the slot emptied,
the Prayer experience (Vile ashes +25 on a normal world), the sequence (delay 0, no spotanim flag) and
the synth (one loop, no delay). Of the 11 recordings rsprox holds with that message, 10 contain seq
2295. A scatter can lack it when another animation replaces it in the same tick: one of 2123's three
scatters came on the tick the player ate a karambwan. The two-tick click delay between scatters is
burying's; the captures only show scatters three or more ticks apart.

Not covered: Demonic Offering (three times the experience), the Ash sanctifier and the sacred bone
burner.

## Events

`server/plugins/skills/Prayer.plugin.js`:

- **`prayer:bury`** `{ player, itemId, scale, crushed }`: buries a bone without the spade. It sets
  `handled`, gives the experience times `scale` and the restore. With `crushed` it skips
  `crush: false` bones.
- **`prayer:bone`** `{ itemId, bone }`: sets `bone` to the bone's row (`xp`, `level`, ...) when
  `itemId` is a bone, for content that gives its own experience without a burial, so no restore
  (the Chaos Temple altar, `BoneAltars.plugin.js`; docs/bone-altars.md).
- **`prayer:bone-restore`** `{ player, itemId, points, restore }`: asked after every burial.
  Listeners set `restore` to `points`, and Prayer gives it back once, up to the Prayer level. So the
  Catacombs (`CatacombsOfKourend.plugin.js`) and a dragonbone necklace
  (`DragonboneNecklace.plugin.js`) never stack, as the Wiki says.

## Dragonbone necklace

Worn, burying or crushing bones gives back their `restore`. It works straight away: the Wiki says
the nine-second wait was removed in April 2021. It is Vorkath's drop, already in `npc-drops.json`.
No capture shows the effect, so it follows the Wiki.

## Bonecrusher

`server/plugins/items/Bonecrusher.plugin.js`. The ghost disciples hand it over after the hard
Morytania diary ([ectofuntus.md](ectofuntus.md)). In the inventory, with charges and active, it
crushes the bones a kill drops on `npc-drops:generated`, one charge each, for half their burying
experience. With the elite Morytania diary it gives all of it.

From rsprox captures (recordings 703, 1857; Leagues V, rev 227-229, the only ones with the item):

| Action | Captured |
| --- | --- |
| Ecto-token on it | every token is used, 25 charges each; synth 1413; "The bonecrusher has 2,125 charges. It is active and ready to crush bones." |
| Check | "The bonecrusher has no charges. It can be charged with ectotokens." or the line above |
| Activity | "The bonecrusher has been deactivated, and will not crush bones now." with synth 974, or "The bonecrusher is active and ready to crush bones." with synth 975 |
| A kill | the bones never land; every hundredth charge, "Your bonecrusher has 5,700 charges left." on the tick the loot appears. The charge count isn't sent to the client |

Not captured, so ours:

- **Check while deactivated:** "The bonecrusher has N charges. It has been deactivated, and will
  not crush bones now." (Activity's line with the count).
- **Uncharge:** returns one ectotoken per 25 charges and keeps the rest (Wiki), then answers with
  Check's line.

Charges are saved in `bonecrusher:charges`, up to 2,147,483,647 (the cache's
`charges_bonecrusher_quantity` holds 31 bits). Deactivating is saved in `bonecrusher:inactive`.

## Not built

- The bonecrusher necklace (bonecrusher + dragonbone necklace + hydra tail).
- Destroying the bonecrusher (the Wiki says its tokens fall out).
- Bones placed in the inventory by Hunter creatures (the Wiki says the bonecrusher takes them).
- The Zealot's robes' chance to save bones and bonemeal (only the Chaos Temple altar has it;
  docs/bone-altars.md).
- The message for burying superior dragon bones below 70 Prayer is ours: "You need a Prayer level
  of 70 to bury these bones."

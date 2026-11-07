# Gold jewellery

Gold bars used on a furnace open the cache's `crafting_gold` interface (446).
All 32 products use the existing Crafting level/XP tables. Quantity buttons choose
1, 5, 10, X or all; the mould stays in the inventory. Each item is produced on
the third tick, then every three ticks, using `human_furnace` (899) and sound 2725.
There is no per-item chat message. Moving, losing ingredients, dying or opening
another interface stops a batch.

Wool on an unstrung amulet works in either order, consumes both ingredients and
awards 4 Crafting XP: “You put some string on your amulet.”

Lvl-1 through Lvl-7 Enchant use `Spell.canCast`: staff rune bypass, inventory/pouch
rune sourcing, spellbook and plugin restrictions. Core validates the inventory
slot and `emitCanUseItem` before dispatching the spell-on-item hook. Manual casts
share the core 600 ms gate and enforce the Wiki's three-tick enchant interval.

## Enchanting jewellery

`plugins/skills/Spells.EnchantJewellery.js` enchants every gold and silver piece the Wiki
lists: rings, necklaces, bracelets and amulets, sapphire to zenyte plus opal (Lvl-1), jade
(Lvl-2) and topaz (Lvl-3).

- **One click enchants them all.** The cast converts the first piece of that item in the
  inventory, in its own slot, then casts again every 7 ticks while more of the same item is
  carried. It stops when none is left, the runes run out, the player walks, or another
  enchant is clicked. A level-up pop-up pauses it, as it does other
  skilling.
- **A cast clicked during the 3-tick delay waits for it** and then goes off (and repeats).
- **Look.** Gold amulets play the spell's own sequence, graphic and sound. Rings, necklaces
  and bracelets play `human_cast_enchantring` (931) with `enchant_ring` (238) at height 92.
  Their sound is 147 for Lvl-1, 142 for Lvl-2, 140 for Lvl-5 and 144 for Lvl-6 and Lvl-7; Lvl-3
  and Lvl-4 keep the spell's sound, as no capture has them. Silver amulets play the spell's
  sequence with `enchant_ring`; so does the jade bracelet, with the ring sound (rsprox 1846). The
  ruby necklace plays the amulet cast (721, 116, 145; rsprox 1757). Every graphic is at height 92,
  and the cast sends `toplevel_sidebutton_switch` [6], back to the spellbook, once per click.
- **Ids.** The sapphire bracelet is `jewl_sapphire_bracelet` (11072) and the zenyte bracelet
  `zenyte_bracelet` (19532), as recorded; `ItemIds.SAPPHIRE_BRACELET` (11071) and
  `ItemIds.ZENYTE_BRACELET` (19492) are other items with the same names.

Evidence:

- [Enchant jewellery](https://oldschool.runescape.wiki/w/Enchant_jewellery): the full recipe
  table; "You can manually cast the spells every 3 game ticks, or if uninterrupted it will
  automatically cast it again every 7 ticks"; the updates of 21 August 2014 (one queued cast),
  21 February 2019 (the next items of the same type enchant automatically) and 12 February
  2025 (the first jewellery in the inventory is converted, not the one the spell was cast on).
- [Lvl-1 Enchant](https://oldschool.runescape.wiki/w/Lvl-1_Enchant): opal jewellery and the
  sapphire bracelet's Bracelet of clay.
- rsprox 4119 (rev 237, a Leagues VI world): one Lvl-1 Enchant on a sapphire ring enchants all
  25 in the inventory, slot by slot, a cast every 7 ticks, each with sequence 931, graphic 238
  and sound 147.
- rsprox 3342 (rev 235): Lvl-7 Enchant on a zenyte bracelet, sequence 931, graphic 238,
  sound 144. rsprox 1135 (rev 237, Leagues VI): Lvl-6 Enchant on an onyx bracelet and an onyx
  necklace (931, 238, sound 144) and on an onyx amulet (721, 452, sound 143). rsprox 1104
  (rev 237, Leagues VI): Lvl-5 Enchant on a dragonstone bracelet (931, 238, sound 140).
- rsprox 3276 (rev 234) and 1102 (rev 237, Leagues VI): ruby, onyx and dragonstone amulets play
  the spell's own sequence, graphic and sound (721/116/145, 721/452/143, 720/154/139).
  rsprox 4211 (rev 238, Leagues VI): a jade amulet plays 720 with graphic 238 and sound 141.

Not done:

- Free-to-play worlds: the Wiki says free-to-play players can only enchant the sapphire
  amulet among the Lvl-1 recipes, but no capture or page gives what a free world says when
  refused, and the members gating lives in `plugins/modes/FreeToPlay.plugin.js`.
- Opal and topaz amulets are assumed to look like the captured jade amulet.

## Evidence

- [PR #548](https://github.com/RSPSApp/tsps/pull/548), merged on 12 October 2026,
  fixes bare item identifiers that previously selected bank placeholders. This
  branch includes that fix and uses the surviving names; bracelet variants and
  Dragon necklace are checked separately against the cache.
- [Wiki Crafting jewellery table](https://oldschool.runescape.wiki/w/Crafting#Jewellery):
  requirements and XP, including 200 XP for Zenyte amulet (u).
- [Lvl-1](https://oldschool.runescape.wiki/w/Lvl-1_Enchant) through
  [Lvl-7 Enchant](https://oldschool.runescape.wiki/w/Lvl-7_Enchant): recipes,
  rune costs, manual timing, GIF animations and sound-file metadata. Diamond
  necklaces produce Phoenix necklaces; Dragon necklaces produce uncharged Skills
  necklaces. The level 6 and 7 GIFs share the amulet effect.
- Cache 241: `dump:widget 446`, scripts 429/2928, sequences 719–721/899,
  spot animations 114–116/153–154/452, and item definitions. The per-level amulet effects
  follow the Wiki spell GIFs; the other casts are under "Enchanting jewellery".
- Furnace timing, interface and message absence follow the PR review's cited live
  rsprox recordings 3150, 724 and 4119; those recordings were not independently replayed.

## Verification

`yarn --cwd server build` and `node --test tests/jewellery-crafting.test.cjs
 tests/jewellery.test.cjs tests/rune-pouch.test.cjs` (from `server/`). The new tests
cover every product and enchant input, stringing in both orders, rune sources,
restrictions, cast cooldowns, make-X timing and interrupted production.

The worktree's agent MCP also checked the real client packet path in Lumbridge:
craft Diamond amulet (u), string it, cast Lvl-4 Enchant, and verify Amulet of power,
67 Magic XP and consumed runes. The headless visual capture timed out, so the
furnace layout and enchant effects still need a manual visual check.

Silver jewellery crafting recipes remain outside this page's scope.

## Dragonstone jewellery charging

The Fountain of Rune charges all eligible jewellery in the inventory and equipment in
one interaction: rings of wealth receive five charges; glories (including trimmed ones),
skills necklaces and combat bracelets receive six. Rings need no quest, glories need
Heroes' Quest, and skills necklaces and combat bracelets need Legends' Quest. Imbued rings
keep their imbue. Using an already full piece still charges other eligible pieces.

Skills necklaces and combat bracelets can be charged in noted stacks at Rune, retaining
their quantities and noted form. Noted glories and rings are excluded. The usual success
message also applies when a ring initiates charging. The existing 1-in-25,000 eternal-glory
roll and its replacement message remain part of the same charging pass.

The Fountain of Heroes charges carried and worn unnoted glories to four. The Legends'
Guild totem charges skills necklaces and combat bracelets to four, leaving pieces with
five or six charges alone. The unrelated Kharazi Jungle totems do not charge jewellery.
The charging handler resolves player-visible cache transforms: the map uses parent
objects 26782 (Rune), 2939 (Heroes) and 2638 (Legends), rather than their display-child IDs.

Evidence checked for these charging rules:

- [Fountain of Rune](https://oldschool.runescape.wiki/w/Fountain_of_Rune): families,
  requirements, bulk inventory/equipment charging, banknotes, charges and success messages.
- [Fountain of Heroes](https://oldschool.runescape.wiki/w/Fountain_of_Heroes): four-charge
  bulk charging of unnoted carried and worn glories.
- [Skills necklace](https://oldschool.runescape.wiki/w/Skills_neckalace) and
  [Jewellery](https://oldschool.runescape.wiki/w/Jewellery): the guild totem's four charges
  and the skills-necklace/combat-bracelet charging location.
- Cache revision 241: morph parents and children, separate Kharazi totems, ring variants
  and item note links. No charging recording was available for these
  sites, so exact animation and tick timing are not asserted here.

Regression checks exercise the registered charging handler with real cache definitions,
including mixed families, worn pieces, imbued rings, full-piece inputs, unmet quests,
noted stacks, both mapped fountains, the guild totem and unrelated totems. Eleven of these
checks fail against the previous charging code. Live interaction checks also verified the
mapped Rune fountain, mixed and noted charging, and both guild charging sites. Quest
completion and supplies were test setup; the quests themselves were not replayed.

## Ring of wealth teleports

Source: the OSRS Wiki's Ring of wealth page (Teleportation section). The ring teleports to the
Grand Exchange entrance (3163, 3478), Falador Park (2995, 3375), Miscellania (2534, 3862) and
Dondakan (2824, 10168), one charge each, from the Wilderness up to level 30. The Wiki states that
Miscellania needs Throne of Miscellania and Dondakan needs Between a Rock... completed. Without the
quest the teleport is refused and the charge is kept. The Wiki gives no refusal text and no
recording of one exists, so the message is ours. The destination tiles are the Wiki's.

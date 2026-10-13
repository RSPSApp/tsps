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
  spot animations 114–116/153–154/452, and item definitions. The per-level effects
  follow the Wiki spell GIFs; jewellery casts have no rsprox captures yet.
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

Silver recipes, bracelet enchanting, opal/jade/topaz enchanting and automatic
repeat enchanting remain outside this PR's scope.

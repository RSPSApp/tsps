# Fletching

Every Fletching recipe on the OSRS Wiki (the Fletching page, "Fletching training" and each product's recipe infobox), built from those pages, rsprox captures (recordings 70, 75, 83, 89, 96, 100, 239, 1098, 1718, 1723, 1749, 1757, 1827, 1857, 3280, 4167 and 4308 on https://rsprox.net/database) and the cache. It is one plugin, `server/plugins/skills/Fletching.plugin.js`, with its units in `server/plugins/skills/fletching/` and every recipe in `server/plugins/skills/data/fletching.json`.

Status:
- **Done:**
  - **Knife on logs:** arrow shafts (redwood too), javelin shafts, bows, stocks, the wooden shields (oak to redwood, two logs each) and the redwood hiking staff.
  - **Knife on other materials:**
    - battlestaves from celastrus bark (and the bark's own Fletch option);
    - hunter's spears;
    - atlatl dart shafts from ent branches;
    - the Greenman statue and carving;
    - camphor, ironwood and rosewood blowpipes.
  - **Stringing:** bows and crossbows, the comp ogre bow.
  - **Crossbows:** stock and limbs with a hammer.
  - **Ammunition:**
    - headless arrows and arrows;
    - darts and bolts, with any feather;
    - tipped bolts and tipped dragon bolts;
    - javelins;
    - ogre and brutal arrows;
    - headless atlatl darts and atlatl darts.
  - **Chisel:**
    - gem bolt tips (pearls give 6 or 24, onyx 24; a jeweller's chisel cuts them every 2 ticks);
    - wolfbone arrowtips;
    - kebbit and antler bolts;
    - the toxic blowpipe;
    - the hunters' sunlight crossbow.
  - **Other assembled items:** the mith grapple, the light and heavy ballistae, the webweaver bow (u).
  - **Requirements:**
    - Big Chompy Bird Hunting started (ogre arrows);
    - Zogre Flesh Eaters: completed for the unstrung comp bow, started for stringing it and for brutal arrows (the Wiki recipes say "Completion" and "Partial completion" respectively);
    - the Slayer unlock Broader Fletching (broad arrows, broad bolts, amethyst broad bolts).
  - **Make-X for darts and bolts:** All Settings 316, varbit `option_fletch_dart_or_bolt_makex`. On by default, it offers a menu of up to 10 sets; turning it off makes one set per click. Saved choices take precedence over the default.
  - **The fletching knife:** a tick off each knife action after the first.
  - **The bow string spool:** account-bound bow strings, Fill/Check/Empty, notes, spare spools for capacity, stringing from it, and filling it from spun bow strings through `crafting:spun`.
  - **Achievement diaries:** stringing an oak shortbow in the Gnome Stronghold and a magic longbow in Tirannwn (Western Provinces), and dragon darts at the Bedabin Camp (Desert). The Wiki lists each bow task's items as the unstrung bow and a bow string, so cutting the unstrung bow doesn't count. The Wiki gives no bounds for these places: the Bedabin Camp box is the one desert heat uses, and the Gnome Stronghold and Tirannwn (with Prifddinas) boxes are our estimates around their walls and towns.
- **Not done:**
  - "Smith and fletch ten rune darts within Varrock" (Varrock elite): there is no Smithing signal to pair it with yet.
- **Elsewhere:**
  - the bone shortbow: `items/ratboneweapons`;
  - the scorching bow: `quests/wgs/Rewards.WhileGuthixSleeps.js`;
  - amethyst tips: Crafting;
  - Vale Totems: `minigames/ValeTotems.plugin.js`.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.Fletching.js` | The recipes resolved to ids, the item pairs that start them, the skillmulti menu, the task, materials (any feather, the spool) and the `fletching:made` event. |
| `Recipes.Fletching.js` | Item on item and celastrus bark's Fletch option. |
| `Spool.Fletching.js` | The bow string spool. |
| `Diaries.Fletching.js` | The diary tasks done by fletching something in a place. |

Each unit has an `init` (ids, recipes, the spool as a bow string source) and an `attach` (hooks only), run in that order as the Slayer plugin does.

A recipe in `fletching.json` takes its group's defaults (tool, ticks, menu, animation, sound, message) and overrides what differs. It starts from one item pair: its tool on its first material, or its first material on its second. Every recipe one pair starts shares a menu, so a knife on teak logs offers the teak stock and the hunter's spear together.

## Behaviour

From the captures:

| Action | What the server sends |
| --- | --- |
| Feather on dart tips | On the click's tick: the tier's `human_fletching_add_dart_feathers_*`, "You finish making 10 darts.", tips and feathers out, darts in. No menu. |
| Feather on unfinished bolts | On the click's tick: `human_fletching_add_bolt_feathers_*`, synth sound 2605, "You fletch 10 bolts.". No menu. |
| Knife on logs | skillmulti mode 0, "What would you like to make?". `human_fletching` on the choice, the first item 2 ticks later and one every 3, each with the animation and "You carefully cut the wood into 30 arrow shafts." (or "some javelin shafts.", "a shortbow.", "a longbow.", "a crossbow stock."). |
| Knife on two logs: a shield | `human_fletching` a tick after the choice, the shield 6 ticks after the choice and one every 7, with "You carefully cut the pieces of wood into a shield.". |
| Feather on arrow shafts | skillmulti mode 3, "How many sets of 15 do you wish to feather?", offering up to 10 sets. `human_fletching_add_feather` on the choice, a set a tick later and one every 2, each with sound 2605 and "You attach feathers to 15 arrow shafts.". |
| Arrowtips on headless arrows | skillmulti mode 3, "How many sets of 15 do you wish to complete?". The same timing and sound, "You attach steel arrowtips to 15 headless arrows." ("broad arrowheads" for broad arrows). |
| Bolt tips on bolts | skillmulti mode 3, "How many sets of 10 would you like to tip?", up to 10 sets, or fewer when fewer can be made. A set a tick after the choice and one every 2, each with `human_fletching_add_bolt_tips_*`, sound 2605 and "You fletch 10 bolts.". |
| Chisel on a cut gem or pearls | skillmulti mode 2, "How many sets of 12 will you make?" (6 for an oyster pearl). The gem's cutting animation and sound 2586 on the choice, the tips 4 ticks later and every 5, each with the animation, the sound and "You use your chisel to fletch small bolt tips.". |
| Javelin heads on shafts | skillmulti mode 3, "How many sets of 15 do you wish to make?". |
| Bow string on an unstrung bow | skillmulti mode 10, "How many would you like to string?", offering what can be made. Nothing on the choice; a bow a tick later and one every 2, each with `stringing_*` and "You add a string to the bow.". A single bow is strung a tick after the click, with no menu. |
| Crossbow string on the only unstrung crossbow | No menu; on the next tick `xbows_stringing_crossbow_*` and "You add a string to the crossbow.". |
| Limbs on a stock | Without a hammer: "You'll need a hammer to do that.". With one, on the next tick: `xbows_fletching_*`, synth sound 2922, "You attach the stock to the limbs and create an unstrung crossbow.". |
| Mith grapple tip on a mithril bolt | No menu. A tick after the click: `human_fletching_add_bolt_tips_mithril`, synth sound 2605, "You add a grapple tip to a mithril bolt.", the tip and one bolt out, the mith grapple in, 11 XP (recording 801, ticks 594-595, an event world paying 15 times: 165). |
| Rope on the mith grapple | No menu and no animation. A tick after the click: synth sound 2605, "You attach a rope to the mithril grapple.", the grapple and rope out, the roped grapple in, no XP (recording 801, ticks 617-618). |

Every Fletching line is a spam (filterable) message. Every capture of darts and bolts was on Leagues worlds, where a click made 20 or 30. The main game makes one set of 10 per click (Wiki, Darts and Bolts).

A task submitted from a click first runs on the next game cycle, so a recipe's `firstTick` n is the capture's tick +n after the choice.

From the Wiki recipes:
- **Logs:** the first item after 2 ticks, then one every 3 ("Make-X is 2, then 3 ticks").
- **Battlestaves:** 4 ticks.
- **Javelins:** 1 tick.
- **Darts and bolts in Make-X:** 2 ticks.
- **Ogre arrow shafts and wolfbone tips:** 2 to 6 per log or bone.

No capture covers javelin timing, the spool or the Varlamore and Sailing recipes, nor messages for the other knife products, crossbows, ogre arrows or kebbit and antler bolts. Their timing follows the Wiki, and the spool's messages are our own. Where no animation is recorded, the generic `human_fletching` plays; a recipe recorded with none (the grapple's rope) sets `"animation": false`. Two grapple tips (or two grapples and two ropes) at once open the generic make menu: no capture shows more than one held. The rope's tick follows recording 801 (+1); Leagues recording 4308 attached it on the click's own tick, and neither is a main-game world.

## Testing

`node --test tests/fletching.test.cjs` after `yarn build`. It covers:
- every recipe resolving;
- the crossbow limb stocks and XP;
- shields and redwood;
- instant and Make-X darts;
- feathers;
- gem tips and tipping;
- the captured tick, message, sound and menu of knife cuts, shields, menu stringing, arrows, tipping, gem bolt tips and the mith grapple;
- the Broader Fletching and quest gates;
- the spool;
- the fletching knife's timing;
- the diary task (strung bow only, inside the area).

## Feather alternatives parity (2026-10-27)

The [Feather](https://oldschool.runescape.wiki/w/Feather),
[Gryphon feather](https://oldschool.runescape.wiki/w/Gryphon_feather) and
[Stymphike feather](https://oldschool.runescape.wiki/w/Stymphike_feather) Wiki pages,
retrieved 2026-10-27, support using both feathers for ammunition. They were missing
from the shared feather alternatives, preventing production and XP. The recipe data
now includes both, including headless arrows, bolts, darts, ogre arrows and atlatl darts.
The gryphon page documents a directional restriction: use the feather on the material;
reverse use returns "Nothing interesting happens." The alternative's `usedOnly` flag
preserves that behaviour without an item-id exception in the handler.

The [Fletching training](https://oldschool.runescape.wiki/w/Fletching_training) page,
retrieved the same day, says dart/bolt Make-X defaults on since Easter 2023. The settings
catalog now supplies that default while retaining either saved choice.

Regression coverage checks both feathers across five ammunition recipes, quantities,
XP, delayed versus instant production, reverse use, level requirements, Make-X and
selected-feather consumption. A separate login regression checks the default and saved
on/off choices. All 49 focused Fletching/settings tests pass; the new production checks
and default check failed before their fixes.

In-game checks used supplied materials and levels: each feather produced 10 rune darts
(188 XP), 10 mithril bolts (50 XP), and 15 headless arrows (15 XP). Reverse gryphon use
returned the documented message without producing darts; reverse stymphike use made 10.
Make-X produced 20 rune darts and 376 XP with each feather. A fresh login received
Make-X enabled, and explicit off and on choices each survived logout/login.
No indexed recording covers either new feather. Recordings 96, 1757 and 3280 cover
ordinary rune-dart feathering on Leagues worlds; they do not establish the new feather
alternatives or the default. No visual timing claim is made.

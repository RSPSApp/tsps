# Fletching

Every Fletching recipe on the OSRS Wiki (the Fletching page, "Fletching training" and each product's recipe infobox), built from those pages, rsprox captures (recordings 96, 239, 1749, 1757, 3280 and 4167 on https://rsprox.net/database) and the cache. It is one plugin, `server/plugins/skills/Fletching.plugin.js`, with its units in `server/plugins/skills/fletching/` and every recipe in `server/plugins/skills/data/fletching.json`.

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
  - **Make-X for darts and bolts:** All Settings 316, varbit `option_fletch_dart_or_bolt_makex`. Off (the default), each click makes one set at once; on, a menu of up to 10 sets.
  - **The fletching knife:** a tick off each knife action after the first.
  - **The bow string spool:** account-bound bow strings, Fill/Check/Empty, notes, spare spools for capacity, stringing from it, and filling it from spun bow strings through `crafting:spun`.
  - **Achievement diaries:** stringing an oak shortbow in the Gnome Stronghold and a magic longbow in Tirannwn (Western Provinces), and dragon darts at the Bedabin Camp (Desert). The Wiki lists each bow task's items as the unstrung bow and a bow string, so cutting the unstrung bow doesn't count. The Wiki gives no bounds for these places: the Bedabin Camp box is the one desert heat uses, and the Gnome Stronghold and Tirannwn (with Prifddinas) boxes are our estimates around their walls and towns.
- **Not done:**
  - "Smith and fletch ten rune darts within Varrock" (Varrock elite): there is no Smithing signal to pair it with yet.
  - Filterable ("spam") chat messages, which the server doesn't support yet.
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
| Feather on arrow shafts | skillmulti mode 3, "How many sets of 15 do you wish to feather?", offering up to 10 sets. |
| Bolt tips on bolts | skillmulti mode 3, "How many sets of 10 would you like to tip?", up to 10 sets, or fewer when fewer can be made. |
| Bow string on an unstrung bow | skillmulti mode 10, "How many would you like to string?", offering what can be made. |
| Crossbow string on the only unstrung crossbow | No menu; on the next tick `xbows_stringing_crossbow_*` and "You add a string to the crossbow.". |
| Limbs on a stock | Without a hammer: "You'll need a hammer to do that.". With one, on the next tick: `xbows_fletching_*`, synth sound 2922, "You attach the stock to the limbs and create an unstrung crossbow.". |

Every capture of darts and bolts was on Leagues worlds, where a click made 20 or 30. The main game makes one set of 10 per click (Wiki, Darts and Bolts).

From the Wiki recipes:
- **Logs:** the first item after 2 ticks, then one every 3 ("Make-X is 2, then 3 ticks").
- **Shields:** 7 ticks.
- **Battlestaves:** 4 ticks.
- **Gem tips:** 5 ticks.
- **Javelins:** 1 tick.
- **Darts and bolts in Make-X:** 2 ticks.
- **Ogre arrow shafts and wolfbone tips:** 2 to 6 per log or bone.

No capture covers knife on logs, gem tips, javelins, shields, the spool or the Varlamore and Sailing recipes. Their timing follows the Wiki, and the spool's messages are our own. Where no animation is recorded, the generic `human_fletching` plays.

## Testing

`node --test tests/fletching.test.cjs` after `yarn build`. It covers:
- every recipe resolving;
- the crossbow limb stocks and XP;
- shields and redwood;
- instant and Make-X darts;
- feathers;
- gem tips and tipping;
- the Broader Fletching and quest gates;
- the spool;
- the fletching knife's timing;
- the diary task (strung bow only, inside the area).

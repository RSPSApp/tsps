# Skillcapes and the max cape

`server/plugins/items/SkillCapes.plugin.js` (members only) with one unit per part in
`server/plugins/items/skillcapes/`, driven by `server/plugins/items/data/skillcapes.json`
(cache gamevals, resolved to ids at load). Behaviour is the OSRS Wiki's (Cape of Accomplishment,
Max cape, each cape's page); menus, messages and tiles come from rsprox captures where they were
recorded (`docs/agents/sources.md`).

## Asking for a perk

Every plugin that cares about a cape asks one question:

```js
const request = { player, skill: "COOKING", inventory: false, result: false };
api.emitCustomEvent("skillcape:has-perk", request);
if (request.result) { /* the perk applies */ }
```

The skill's own cape (untrimmed, trimmed, or its worn id) answers, as does the max cape. The
combined max capes keep only the Cooking, Crafting, Runecraft and Firemaking perks (Wiki: Max
cape). `inventory: true` also counts a carried cape (the Prayer cape's holy wrench, the
Firemaking cape's light, the Slayer cape's repeat chance).

| Perk | Where |
| --- | --- |
| Attack: Kamfreena without tokens | `areas/warriors-guild/Common.WarriorsGuild.js` |
| Cooking: never burns; Cooks' Guild entry | `skills/Cooking.plugin.js`, `areas/CooksGuild.plugin.js` |
| Crafting: Crafting Guild entry | `areas/CraftingGuild.plugin.js` |
| Defence: ring of life (toggle, Ardougne after the medium diary) | `items/RingOfLife.plugin.js` via `skillcape:ring-of-life` |
| Farming: herb lives | `skills/farming/Patches.Farming.js` |
| Firemaking: light source | `world/Darkness.plugin.js`, `world/FairyRings.plugin.js`; Wintertodt warmth is its Wiki name list |
| Herblore: grimy herbs into unfinished potions with cleaning XP; Zahur | `skills/Herblore.plugin.js`, `npcs/Zahur.plugin.js` |
| Hitpoints: regeneration every 30 seconds (not with Rapid Heal) | core `stats:hitpoints-regen` (Player.ts), answered in `Passive.SkillCapes.js` |
| Mining: 5% extra ore up to adamantite | `mining:extra-ore`, answered in `Passive.SkillCapes.js` |
| Prayer: holy wrench, worn or carried | `items/Potions.plugin.js` |
| Ranged: accumulator (72%), assembler/upgraded max capes (80%), metal gathering | `items/AvasAccumulator.plugin.js` via `skillcape:ammo-recovery`; `skillcapes/MetalAttraction.SkillCapes.js` |
| Runecraft: every altar without talisman or tiara (varbits `rc_no_tally_required_*`) | `skills/Runecrafting.plugin.js` |
| Sailing: teleport a boat to the Pandemonium and rename a boat | `skills/sailing/BoatTeleport.plugin.js` via `sailing:cape-teleport` / `sailing:cape-rename-boat` |
| Slayer: no combat requirement (worn); 10% previous task (carried) | `skills/slayer/Tasks.Slayer.js` |
| Smithing: gold bar XP; coal bag holds 36 | `skills/Smithing.plugin.js`, `items/storage/CoalBag.StorageItems.js` |
| Thieving: +10% pickpocket | `skills/thieving/Pickpocket.Thieving.js` |
| Woodcutting: +10% nests | `skills/Woodcutting.plugin.js` |
| Agility: graceful cape substitute | `items/GracefulOutfit.plugin.js` |

## Units

- **Sellers**: the masters' Wiki transcripts, with their shared conditions answered (99 in the
  skill, 99,000 coins, two free slots) and hand-outs given; Hickton, Aubury, Wizard Sinina,
  Martin Thwait and the Ranging Guild armour salesman open a copy of their shop with the cape
  (ids from 1600; one copy for the untrimmed cape, one for trimmed). A shop cape needs two free
  slots ("Skillcapes come with a free hood, so you need 2 empty inventory slots for each one that
  you want to buy.") and the hood comes with it. The Estate agent still sells the Construction
  cape (core).
- **Trimming**: a second 99 trims every skillcape carried, worn or banked; also on login and on
  picking one up.
- **Boost**: wearing a cape, or its worn Boost, raises the skill to 100 until it decays; not again
  above 99. Hitpoints and Prayer: once a minute ("Your Skillcape of Hitpoints can only provide a
  hitpoint boost once per minute.", captured).
- **WornVariants**: the max cape (`skillcape_max` -> `skillcape_max_worn`) and Agility cape swap to
  their worn ids, which carry the equipment-tab options (captured).
- **Teleports**: tiles from captures - Warriors' Guild 2865,3546; Crafting Guild 2931,3286; Farming
  Guild 1247,3726; Fishing Guild 2604,3401; Otto's Grotto 2504,3484; Hunter Guild 1558,3046;
  carnivorous chinchompas 2556,2916; the house portals (Yanille 2544,3095, Hosidius 1744,3517 and
  the rest at the portal). Hunter: five chinchompa teleports a day ("You have # teleports
  remaining today.", varbit `chinchompa_teleports`); the guild after Guildmaster Apatura's
  upgrade (his transcript's `upgrading-a-skillcape`). Construction's Teleport opens the menu
  interface "House portal teleports". Sailing and the max cape's Pandemonium, boat and
  "Teleport Boat (Pandemonium)" entries go to `sailing:cape-teleport`; "Rename Boat" goes to
  `sailing:cape-rename-boat` (BoatTeleport.plugin.js).
- **Options**: Stamina Boost (once a day, "You feel reinvigorated."), Search (pestle and mortar,
  `searchcape_pestle`; grapple and crossbow three times a day, `searchcape_grapple`, varbit
  `free_grapple`), Spellbook ("Choose spellbook: (5/5 left)", "Arceuus spellbook activated.",
  "You have changed your spellbook #/5 times today.", varbit `sb_swap_check`), Commune, Defence
  toggles (varbit `rol_toggle`).
- **MaxCape**: Mac's transcript (2,376,000 coins; sells back for 80%), its Teleports menu ("Select
  a destination"), Features ("Select an option": Search, Ring of Life settings, Commune, Stamina
  Boost), worn submenus, combining ("You need your max cape hood to be able to combine those.",
  "You will lose your Infernal cape if you proceed!", locked items "Combine your Infernal cape (l)
  with your max cape?") and knife disassembly - all as captured.
- **MacIsland**: the way to Mac (evergreen, stump, rockslide, boulder, log raft, row boat back),
  each needing its 99, as captured in recordings 3143-3146. The row boat lands beside the
  Sinclair Mansion (2726,3589), as live OSRS does.
- **Cooks' Guild door** (`areas/CooksGuild.plugin.js`): no door handler covered `chefdoor`, so it
  never opened; it is now walked through as captured (recordings 3181, 3213). The stump and mined rockslide jumps
  are agility shortcut data.

Daily allowances reset at 00:00 UTC and are kept in `skillcapes:daily`; the cache varbits
mirror them for the client.

## Not captured (ours or the Wiki's prose)

- Refusals for a missing 99 on the way to Mac, making the raft, and Mac's island boulder.
- The black chinchompa teleport tile (beside the Wilderness black chinchompas), the daily limit
  refusals, the Hunter Guild lock message, the coal bag's messages, Zahur's messages, the
  Crafting Guild's level and bank refusals, the Vorkath's head upgrade message.
- The Fletching search message, and the Commune and Defence toggles' follow-up prompts (their
  first message boxes are captured), are ours; Near-Reality's port (an RSPS, not a source) was
  only looked at for which options exist.
- Disassembling also turns a carried matching hood back into a max hood (the captured player's
  hoods were banked).
- The Ardougne save tile (the marketplace, 2662,3305) is approximate.

## Open

- Essence pouches never degrade in tsps, so the Runecraft cape's no-decay perk has nothing to stop.
- The max hood choice at Mac is a chat menu, not the live interface.
- Rename the boat through one validated text prompt rather than the live descriptor/noun list.

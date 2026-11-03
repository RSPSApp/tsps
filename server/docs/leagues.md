# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, tasks, ranks, relic tiers and relics, area unlocks, combat
masteries and the league screens. Plugins: `plugins/modes/LeagueMode.plugin.js` (the profile,
its league, XP rate, the tiers' passives, journal tab, Summary / Info / Rank, ranks, statistics
and shared content), `LeaguePoints.plugin.js` (points), `LeagueTasks.plugin.js` (the task catalog, triggers and list), `LeagueRelics.plugin.js` (tiers and
relics), `LeagueAreaUnlocks.plugin.js` (areas), `LeagueCombatMasteries.plugin.js` (Raging
Echoes' combat masteries) and `LeaguePacts.plugin.js` (Demonic Pacts' pact tree); data in `plugins/modes/data/leagues.json`, `league-ranks.json`,
`league-relics.json`, `league-areas.json`, `league-boosted-drops.json` and
`league-combat-masteries.json`, `league-tasks.json` (generated), `league-task-list.json` and
`league-task-triggers.json`.

## The league character

Live OSRS runs Leagues on their own worlds, where an account plays a fresh character. Here a
world runs a league when its plugin config says so:

```json
"pluginConfig": { "league:type": 6 }
```

(every league the cache names in enum 2670: 1 Twisted, 2 Trailblazer, 3 Shattered Relics, 4
Trailblazer Reloaded, 5 Raging Echoes, 6 Demonic Pacts, the league this cache carries and the
data's `default`, which a league character takes when the config names a type the data does not
know; `world.local.json` can set it per
deployment, and `pluginConfig` `"league:start"`, an ISO date, says when the league began for the
client's league clock). LeagueMode reads it at startup and claims the world's character profile
(`api.setWorldProfile`, `GameConstants.WORLD_PROFILE`), so every login is the account's **league
character**, a save kept apart from its main one (`persistence/PlayerProfile.ts`):

- JSON saves: `data/saves/characters/league/<name>.json` beside the main `<name>.json`.
- SQLite and IndexedDB: the key `league:<name>`, prefixed after the name is normalised, so no
  account name can collide with it.
- `Player.getProfile()` says which character is online; it is never written into the save. Both
  share the name, so only one can be online at a time, as on live, and friends see the account
  online either way.
- The account has one credential: its main character's. A league character's own hash only
  stands in while no main character exists (an account first made on a league world), and a
  main character made later takes it. So a name can't be claimed on either world with a password
  of one's own, and `::changepassword` (`PlayerPersistence.changePassword`) writes the new hash
  to both characters and signs out every remembered login on both.
- A "Stay logged in" token belongs to the character it was issued on (each save keeps its own),
  and the world decides the character, so a token from one world's character never opens the
  other's.
- Every league character plays as a standard Ironman (Wiki "Player restrictions": all players
  are Ironmen). Every league login sets a character that is anything else (new, made before this
  rule, or changed with `::ironman`) through the Ironman plugin's `ironman:set-mode`; the Ironman
  plugin's trading, loot, shop and Grand Exchange rules then apply as to any Ironman. The mode
  stays: the Ironman tutor's and Adam's setup ask `ironman:change-mode` before a change, and
  LeagueMode refuses it for a league character ("As a league character, you are always an
  Ironman.", ours). `::ironman` overrides it only until the next login. A main character's mode is
  its own. The rule needs the Ironman plugin enabled; with it disabled in world.json a league
  character is not an Ironman and nothing says so.
- Admin and save commands that look a save up by name address the character this world logs in:
  the league character on a league world (`GameConstants.WORLD_PROFILE`), the main one elsewhere, so a plain world is unchanged. That is
  `::snapshots`, `::rollback` and `::reprocorruptsave`, and the save-exists check of `::mute`,
  `::unmute`, `::ban` and `::unban` (those four are still stubs that punish nobody).
- Known limits: the SQLite backend's one-time import of legacy JSON saves reads only the main
  files; an offline update to either save (an external store purchase) is refused while the
  account's other character is online, since both share the name; the friends chat's offline
  owner lookup (`FriendsChatManager.js`) and the AI bots' name checks (`RegisterAiBots`,
  `PlayerFactory`) still read the main save only, so on a league world an offline owner's channel
  is the main character's and a name held only by a league character counts as free for a bot.

The world's league is the one a new league character joins; the character keeps it in
`league:type`. A new character starts at the league's levels (Wiki: Trailblazer and Trailblazer
Reloaded Herblore 3, Runecraft 5, Agility 10; Raging Echoes and Demonic Pacts Herblore 3 and
Runecraft 5; Twisted Herblore 3; Shattered Relics none, its skills being unlocked with Renown). A
main character never has a league, whatever its attributes say. Leagues I-III have their names,
colours and screens here but no relic, area or task catalogs yet.

## Events

| Event | Payload | Who answers |
| --- | --- | --- |
| `journal:tab-mounted` | `{ player, groupId, tabIndex }` (SideJournalDefaults) | LeagueMode listens |
| `league:profile` | `{ player } -> { league: type \| null }` | LeagueMode |
| `league:login` | `{ player, league }` after a league profile's login | LeaguePoints, LeagueRelics listen |
| `league:highest-tier` | `{ player } -> { tier }` (0-based, -1 none) | LeagueRelics |
| `league:award-task` | `{ player, id, points, name } -> { awarded }` | LeaguePoints (once per id) |
| `league:points` | `{ player } -> { points, tasks }` | LeaguePoints |
| `league:saved-points` | `{ save } -> { points, tasks }` (an offline league character's save) | LeaguePoints |
| `league:account-points` | `{ player } -> { leagues, total }` (a main character's league points, by type) | LeagueMode (Records) |
| `league:award-renown` / `league:spend-renown` | `{ player, amount } -> { awarded }` / `{ spent }` (Shattered Relics' Sage's Renown) | LeagueMode (Shattered) |
| `league:renown` | `{ player } -> { renown }` | LeagueMode (Shattered) |
| `league:grant-fragment` | `{ player, id, xp? }` owns a Shattered Relics fragment | LeagueMode (Fragments) |
| `league:unlock-skill` | `{ player, skill }` unlocks a Shattered Relics skill for free | LeagueMode (Unlocks) |
| `league:unlocks` | `{ player } -> { skills, bosses, quests }` | LeagueMode (Unlocks) |
| `league:open-tasks` / `league:open-fragments` / `league:open-unlocks` | `{ player }` from Shattered Relics' side panel | LeagueTasks (#1358) / Fragments / Unlocks |
| `league:completed-tasks` | `{ player } -> { ids }` | LeaguePoints |
| `league:complete-task` | `{ player, id } -> { found, completed }` (a catalog task, by id) | LeagueTasks |
| `league:points-changed` | `{ player, points, previous, tasks, previousTasks }` | LeagueMode (journal), LeagueTasks, LeagueRelics, LeagueAreaUnlocks listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |
| `league:masteries` | `{ player } -> { league, masteries: { melee, ranged, magic }, passiveTier, points: { earned, spent, available }, challenges }` | LeagueCombatMasteries |
| `league:mastery-point` | `{ player, challenge, earned }` after a Combat Mastery point | - |
| `league:mastery-unlocked` | `{ player, style, tier, key, passiveUnlocked }` after an unlock | - |
| `stats:heal` | `{ player, previous, amount, hitpoints }` before any heal (core); `amount` may change | LeagueCombatMasteries |
| `skills:restore` | `{ player, skill, amount, max }` before a stat restore or boost (core); `amount` may change | LeagueCombatMasteries |
| `combat:hit-rolled` | `{ attacker, target, combatType, damage, minimum, maximum }` after a hit's damage roll, before defences (core); `damage` may change | LeagueCombatMasteries |
| `league:relics` | `{ player } -> { league, chosen }` (tier index -> slot) | LeagueRelics |
| `league:content-rows` | `{ player, league, base, structs, enums, dbRows }`: units push the rows the client lacks | LeagueRelics (Catalog), LeagueTasks (Catalog), LeagueMode (Rank), LeagueAreaUnlocks answer |
| `league:send-content` | `{ player }`: send the content payload again (before an interface opens) | LeagueMode (Content) |
| `league:rank` | `{ player } -> { rank, name, next }` (ranks reached 0-7, the next threshold) | LeagueMode (Rank) |
| `league:statistics` | `{ player } -> { counters }` (the summary's rows by name) | LeagueMode (Statistics) |
| `league:joined` | `{ player, league }` the first time a character joins its league | LeagueMode (Tutorial) listens |
| `league:area-unlocked` | `{ player, league, area, slot }` when an area is unlocked | LeagueAreaUnlocks (#1352) emits; Tutorial listens |
| `league:tutorial-stage` | `{ player } -> { stage }` (league_tutorial_completed while a tutorial runs) | LeagueMode (Tutorial) |
| `screen-highlight:show` / `:close` / `:finished` | a walkthrough in an interface (see Tutorial) | ScreenHighlight |
| `interface:opened` | `{ player, groupId, targetUid, type }` whenever a group is mounted (core, PacketSender) | Tutorial listens |
| `welcome-screen:shown` | `{ player }` when the welcome screen is up | Tutorial, Welcome listen |
| `league:areas` | `{ player } -> { league, unlocked: [area ids], next: { slot, tasks } \| null, available }` | LeagueAreaUnlocks |
| `league:area-at` | `{ x, y, player \| league } -> { area: id \| null, name }` | LeagueAreaUnlocks |
| `league:teleport-cast` | `{ player } -> { cast: { steps, lockTick, landTick } \| null }` (the league's area-teleport cast, `teleportCast`) | LeagueAreaUnlocks |
| `league:relic-triggered` | `{ player, relic }` when a once-in-a-while relic fires (Undying Retribution, Last Stand) | LeagueRelics emits |
| `ironman:set-mode` | `{ player, mode } -> { handled }` (the Ironman plugin's) | LeagueMode emits at a league login |
| `ironman:change-mode` | `{ player, from, to, allowed, reason }` (the Ironman plugin asks before a setup choice) | LeagueMode refuses for a league character |

The client keeps one `structOverrides` and one `enumOverrides` set and replaces each whole on
every dataset (`GamemodeContentStore`), so no plugin sends them itself: LeagueMode sends the lot
at login and whenever a plugin emits `league:send-content` (before its interface opens), after
collecting every plugin's rows with `league:content-rows`.

The tier passives answer other plugins' questions rather than events of their own (below):
`npc-drops:chance` and `drops:chance`, `minigame:points`, `slayer:task-reward`,
`slayer:superior-spawn` and `treasure-trails:scroll-boxes`.


The relics also answer these generic questions, which their owners ask of any content (the
relics are the first askers; nothing changes when nobody answers):

| Event | Owner | Payload |
| --- | --- | --- |
| `ranged:ammo-saving` | core `CombatFactory.decrementAmmo`, the blowpipe and chinchompa handlers | `{ player, itemId, amount, saved }`: `saved` shots are neither broken nor dropped |
| `combat:consume-charge` | the powered staves (already), the crystal bow, venator bow, scythe, crystal halberd, Arclight, warped sceptre, bone staff | `{ player, itemId, skip }` |
| `combat:bolt-proc-chance` | EnchantedBolts | `{ player, target, itemId, chance }` after the gear's and the special's multipliers |
| `combat:status-apply` | core `CombatFactory.poisonEntity` (poison, venom), DragonfireProtection (dragonfire) | `{ target, kind, allow }`; `allow = false` and the status never takes |
| `combat-special:cost` | core `CombatSpecial` (the energy check and the drain) | `{ player, specialId, cost, available, allow, phase }`; `phase` is "check" or "drain"; `allow` lets a short player use it |
| `combat-special:regenerate` | core `RestoreSpecialAttackTask` | `{ player, amount }` a restore cycle (the cycle length is the lightbearer modifier's) |
| `registerMeleeStrengthBonusModifier` | core `DamageFormulas.calculateMaxMeleeHit` | `(entity, strengthBonus) -> strengthBonus`: added to the worn melee strength bonus before the max-hit formula (Demonic Pacts' prayer-bonus and Strength-level pacts) |
| `registerRestingLevelModifier` | core `SkillManager.getRestingLevel`, read by `Player.processStatRestoration` and Potions' boost decay | `(player, skill, level) -> level`: a permanent boost; restoration climbs to it, decay stops at it (Demonic Pacts' Defence pact) |
| `skills:experience-gained` | core `SkillManager.addExperience`, after the gain | `{ player, skill, experience, multiplied }` |
| `storage:gather`, `storage:room` (extended) | Mining, Woodcutting, Fishing | the existing `{ player, itemId, amount, stored }` now carries `skill` and the resource's `xp`, so a listener can bank or double what a skill gathered; `storage:room` carries `skill` too, so a relic answers room only for its own skill's resource (and for what its tool's mode turns it into) |
| `mining:attempt`, `woodcutting:attempt`, `fishing:attempt` | the skill, after its success roll | `{ player, ..., success }`: a listener may turn a miss into a hit (Fishing then lands the best fish the player can) |
| `mining:deplete-rock` | Mining | `{ player, object, rock, handled }`: handled keeps the rock standing |
| `fishing:tool`, `fishing:interval` | Fishing | `{ player, variants, variant }` when no tool was found (a `variant` with `baitless` fishes without bait and uses none); `{ player, ticks }` before each catch roll |
| `woodcutting:tool`, `mining:tool` | Woodcutting (`findBestUsableAxe`, so `woodcutting:axe` without an `itemId` too), Mining (`findBestPickaxe`, so `mining:best-pickaxe` too) | `{ player, axes, axe }` / `{ player, pickaxes, pickaxe }` when the player holds none they can use: a listener may stand in for one (the lists are the skill's own, best first) |
| `cooking:cooked`, `smithing:bar-for-ore`, `crafting:cut-gem`, `fletching:shafts` | Cooking, Smelting, Gems, Fletching | lookups: what a raw item, ore, uncut gem or log turns into and the XP |
| `hunter:catch-chance`, `hunter:rewards`, `hunter:lure-interval`, `hunter:jar-kept` | Hunter | `{ player, npcId, chance }` in the shared roll; `{ player, kind, npcId, rewards, xp }` for a trap's catch; `{ player, kind, ticks }` between an idle trap's looks; `{ player, kept }` for an impling jar |
| `thieving:loot`, `thieving:done`, `thieving:deplete-stall`, `thieving:stall-watch`; `pouchLimit` and `alwaysSucceeds` on `thieving:pickpocket-target` | Thieving | `{ player, npc, target, loot }` before the loot is handed over; `{ player, kind, npc \| object, succeeded, again }` after a pickpocket or theft (again repeats the click a tick later, while neither the player nor the NPC has moved); `{ player, object, handled }` before a stall empties; `thieving:stall-watch` `{ player, object, unseen }` before a theft's guard and owner check (`unseen` skips it) |
| `agility:roll`, `agility:lap-reward`, `agility:mark`, `agility:mark-chance`, `agility:mark-taken` | Agility | `{ player, objectId, success }` after the obstacle roll; `{ player, course, count, xp }` before a lap is recorded; `{ player, location, items }` as a mark spawns; `{ player, course, chance }` before a lap's mark roll (after the overlevel cut); `{ player, course, completesLap, items }` as a course's own mark is picked up (with room for it): `completesLap` finishes a lap of that course, `items` go to the inventory (the floor when full) |
| `agility:course-item` | Agility, as an obstacle's own find is handed over (Prifddinas's portal shard) | `{ player, course, itemId, amount }`: `amount` may change; what the inventory can't take goes to the floor |
| `skills:level-boost` | Crafting, Smithing, Herblore, Fletching and Cooking, where they check their own level | `{ player, skill, boost }`: an invisible boost |
| `skills:actions-per-cycle` | every make-X loop of those five skills (smithing sessions, fletching, mixing, cleaning, the crafting loops, pottery, cooking) | `{ player, skill, kind, recipe?, actions }`: how many items one cycle makes; `kind` names the loop (`smelt`, `smith`, `cannonballs`, the fletching group, `mix`, `clean`, `gems`, `leather`, ...) |
| `skills:action-interval` | Mining, Woodcutting, Cooking (fires, ranges), Firemaking, BoneAltars, Fletching, Smithing sessions, Crafting loops and pottery, Farming (rake, harvest), core alchemy, Superheat Item, jewellery enchanting, Transmute's casts, Wintertodt (roots chopped and fletched, a brazier lit), Tempoross (harpooning) (`SkillActions.actionInterval`) | `{ player, skill, kind, ticks }`: the ticks to the loop's next roll, item, offering or cast; a listener may lower `ticks` (never under 1); a tool's saving (a fletching knife's tick) comes off after the answer, so the two stack; `kind` names the loop (`mine`, `chop`, `cook`, `light`, `tend`, `offer`, the fletching group, a smithing session's type, a crafting kind, `rake`, `harvest`, `alchemy`, `superheat`, `enchant`, `transmute`, `roots` (Woodcutting and Fletching at Wintertodt), `brazier`, `tempoross`) |
| `skills:produced` | each product of those loops | `{ player, skill, itemId, amount, xp }` once it is made |
| `herblore:mix` | Herblore, before a potion's ingredients go | `{ player, recipe, consume, returns, productId }`: a listener may lower a `consume` or `returns` count or change the product |
| `herblore:herbs` | Herblore | lookup: every herb `{ grimyId, cleanId, level, xp }` |
| `firemaking:light-roll`, `firemaking:logs-per-action` | Firemaking | `{ player, success }` after the lighting roll; `{ player, logId, amount }` for the logs one action burns |
| `shop:buy-price`, `shop:delivery` | core `ShopManager` (the price shown, the value check and the purchase; the purchase) | `{ player, shopId, shopName, currency, itemId, price }`: a priced item may become free (0), never below; `{ player, shopId, currency, itemId, deliverId }`: the purchase is handed over as `deliverId` (a note), whose own stacking decides the room it needs |
| `shop:keep-stock` | core `ShopManager` (a purchase, as it takes the stock) | `{ player, shopId, itemId, amount, keep }`: `keep` leaves the shop's own stock as it was, so only stock above its own amount (what players sold it) goes; ShopStock.LeagueMode.js keeps it for a league whose `shopStock.keep` is set (Leagues VI) |
| `shop:can-sell`, `shop:sell-price` (extended) | core `ShopManager` | the existing payloads now carry `player` (when a player is selling) and `currency` |
| `magic:alchemy-policy` (extended) | core `MagicOnItemPacketListener` | asked before the level check (the zone rules still follow it), now with `requiredLevel`, `freeRunes`, `keepItem` and `recast` (cast again on the slot once this cast ends while it holds the same item); a plugin that turns the cast into something else (Mage Training Arena, While Guthix Sleeps) clears `confirm`, `keepItem` and `recast` |
| `bone-altars:offering` | BoneAltars | `{ player, itemId, boneItemId, cost, anyAltar }`: an item that is not a bone offered as `boneItemId`, `cost` of it an offering, and with `anyAltar` on any altar one prays at (the bone's burying XP; a private area's altars, a house's, stay its own) |
| `farming:plant-rules` | Farming, as a seed or sapling is planted | `{ player, crop, seedId, patch, keepSeed, grown, diseaseFree, undying, message }`: a line said after the planting's own; keep the seed, grow the crop at once (not anima plants), keep it from disease, or keep a diseased crop from dying (it waits for a cure); the last two are kept on the patch's state |
| `farming:level-rules` | Farming, as a seed or sapling is planted, a seedling made or a scarecrow made or placed without the level | `{ player, kind, required, waived }`: `kind` is `plant`, `seedling` or `scarecrow`; set `waived` to let the player do it anyway |
| `farming:check-health` | Farming, after a grown crop's health check | `{ player, crop, type, patch, experience }`: `experience` is the check's Farming XP |
| `runecrafting:essence` | Runecrafting, at an altar that binds pure essence | `{ player, pure }`: push item ids that bind there as pure essence would |
| `farming:harvests-per-action`, `farming:pick` | Farming | `{ player, patch, crop, harvests }` picks an action; `{ player, crop, patch, itemId, amount, experience, stored }` before a pick is handed over (`experience` is the pick's Farming XP; `stored` what a listener took itself, as the bank) |
| `skills:produced` (extended) | the production skills | now with `kind` (the loop, as `skills:actions-per-cycle` names it) and, for leather and jewellery, `materials` (`[id, amount]` one product used) |
| `construction:materials` | Construction, before a build's materials go | `{ player, buildable, materials }`: a listener may lower an amount |
| `magic:enchant-pieces`, `magic:spell-batch` | the jewellery enchantments; the Lunar crafting spells | `{ player, spellName, itemId, pieces }` pieces a cast enchants, each with its XP; `{ player, spellName, batch }` items a cast converts |
| `magic:alchemy-policy` (extended) | core alchemy | now with `high` (High Level Alchemy) |
| `minigame:chance` | the Motherlode Mine (`golden-nugget`), Hunter's drift nets and the Volcanic Mine (`fossil-island` `fossil`) | `{ player, minigame, kind, multiplier }`: the find `multiplier` times as likely |
| `big-chompy-bird-hunting:kill-credit` | Big Chompy Bird Hunting's kill count | `{ player, kills }` a chompy kill counts for |
| `thieving:pickpocket-target` (extended) | Thieving | now with `chanceBonus` (a percent more success, stacking as the gloves of silence do) and `painless` (a stun without the damage) |
| `thieving:loot` (extended) | Thieving | now with `multiplier`, applied with the rogue outfit's doubling as the loot is handed over |
| `prayer:bury` (extended) | Prayer | now scatters demonic ashes too (never for the bonecrusher's `crushed`) |
| `teleport:landed` | core `TeleportHandler`, as a teleport lands; the home teleport, fairy rings, spirit trees and Wilderness obelisks, which move the player themselves | `{ player, from, fromInstance, to }`: where it began, whether in an instance, and where it landed |
| `league:fragments-changed` | LeagueMode (Fragments) | `{ player }` after Equip, Unequip or Unequip all changes the fragment slots |
| `woodcutting:nest-chance`, `woodcutting:nest-drop` | Woodcutting | `{ player, multiplier }`: a bird nest `multiplier` times as likely; `{ player, itemId, handled }` before a nest falls (handled: a listener took it) |
| `farming:open-seed-vault` | Farming (the guild's seed vault) | `{ player, opened }`: the vault's menu from anywhere, behind the Bank PIN as at the guild |
| `miscellania:rules` | Managing Miscellania | `{ player, ruler, royalTrouble, payMultiplier, outputMultiplier, approval, visiting }`: who rules the kingdom (the quests), what the workers' pay costs, how much they gather (clues as rolled), an approval held fixed, whether a catch-up away from the islands counts as a visit |
| `miscellania:open` (extended), `miscellania:check`, `miscellania:collect` | Managing Miscellania | `{ player, opened }` opens the kingdom's interface; `{ player, handled }` reports the approval and coffers, or collects as Advisor Ghrim's Collect does |
| `npc-drops:tertiary-chance` (extended) | NpcDrops | a rule may give `outOf` (each matching entry at least 1 in that many) or `guarantee` (the rarest matching entry when none hit) instead of `multiplier` |
| `hunter:impling-clue-chance` | Hunter, opening an impling jar | `{ player, impling, tier, oneIn }` for each clue the jar can hold |
| `hunter:impling-loot`, `hunter:rumour-reward`, `hunter:sack-rolls` | Hunter (impling jars, Hunters' rumours, Hunters' loot sacks) | `{ player, impling, rewards }` for a jar's loot, before its clue rolls; `{ player, tier, xp }` as a rumour is handed in; `{ player, tier, rolls }` for a sack's loot rolls (not its blueprint, kit and outfit rolls) |
| `quetzals:whistle-charge` | Quetzals (a whistle's flight, as it lands) | `{ player, itemId, kept }`: `kept` and the charge stays |
| `treasure-trails:vessel-chance` | Woodcutting and Hunter (clue nests), Mining (geodes), Hunter's drift nets and aerial fishing (bottles) | `{ player, vessel, tier, multiplier }`: the vessel `multiplier` times as likely |
| `treasure-trails:trail-length`, `treasure-trails:casket-rolls` | Treasure Trails (both trail kinds) | `{ player, tier, length, minimum, maximum }` as a trail starts; `{ player, tier, rolls, minimum, maximum }` as a casket opens; both kept within the tier's range |
| `treasure-trails:casket-opened` | Treasure Trails' caskets | `{ player, tier }` after a casket's rewards are handed over (not the Mimic's) |
| `treasure-trails:requirement-waived` | Treasure Trails | `{ player, kind, waived }`: `kind` "emote" (what to wear), "falo" (the item to show) or "charlie" (the item to bring) |
| `slayer:always-on-task` | Slayer, for a Slayer monster the task does not cover | `{ player, npc, npcId, name, onTask }`: counted as on task everywhere `slayer:on-task` is asked, and a kill gives its Slayer XP and superior chance without counting down the task (`offTask` on `slayer:task-kill`; no keys) |
| `slayer:superior-again` | Slayer's superiors, as one dies | `{ player, npc, chance }`: the chance (0 to 1, 0 unless answered) of another of the same superior where it died |
| `slayer:helmet` | SlayerHelmet, Slayer's protective equipment, when no mask or helmet is worn | `{ player, worn }`: set `worn` to `imbued` or `plain` for that helmet's on-task boosts and protection |
| `slayer:superior-spawned`, `slayer:superior-rewards` | Slayer's superiors | `{ player, npc, superior }`; `{ player, npc, normalId, drops, uniqueBoost, extraRolls }` as a superior drops: more rolls on the normal monster's table, a higher unique chance, drops of its own |
| `slayer:reward-cost` | Slayer's reward shop | `{ player, kind, cost, bit?, itemId? }` for an unlock, extension, cancel, block or purchase; never below 0 |
| `fairy-rings:destinations`, `spirit-trees:destinations` | FairyRings, SpiritTrees | `{ list }` -> `{ code, name, location }` for every ring with a destination; `{ player, list }` -> `{ name, location }` for the trees the player could travel to now |
| `construction:jewellery-box-destinations` | Construction's jewellery box | `{ player, list }` -> `{ label, location, wildernessLevel }` for the ornate box's destinations (its jewellery's Wilderness level: 30 for dragonstone pieces) |
| `treasure-trails:stashes`, `treasure-trails:current-step` | Treasure Trails | `{ list }` -> `{ tier, location }` for every STASH unit; `{ player, location, target }`: where the clue read last leads, while that trail is carried; `requirement-waived` now carries `itemId` (Falo's item) |
| `magic:spell-unlocked` | the Mage Arena's god spells | `{ player, spellId, unlocked }` asked before a locked spell is refused |
| `slayer:bracelet`, `slayer:remote-task` | Slayer | `{ player, npc, bracelet, chance, consumeCharge }` for the bracelet of slaughter; `{ player, allowed }` after a gem, ring or helmet check: a new task from the last master or a cancel, from anywhere |

## What the client is sent

From the rsprox Leagues V recordings (osrs-captures 227/00070 and 227/00075; the packets are the
same for every league):

- Login: varbits `league_account` 10031 = 1, `league_type` 10032, `league_tutorial_completed`
  10037 = 12, `league_total_tasks_completed` 10046, `league_rank_notification` 17299 (the ranks
  reached), `current_runeday` 9535 (whole days since 27 February 2002: live sends it with the
  journal tabs and the Info panel's script reads it); varps `league_points_completed` 2614,
  `league_points_claimed` 2615, `league_points_previous` 2807, the summary's tracking varps
  (below) and, when the world's `league:start` is set, `tracking_playtime_leagues` 4523 =
  minutes since the epoch of the league's start (the same value for every player in the Leagues V
  captures, 27 November 2024, so it is the league's clock, not a play time); the relic selection
  varbits.
- A task award: 10046 and 2614 rise, then 2615; the popup (`notification:show`) "League Task
  Complete!" / "Task Completed: <col=ffffff>Name</col><br><br>Points Earned: <col=ffffff>N</col>"
  in the league's colour with jingle 283, the game message "Congratulations, you've completed an
  easy task: <col=20C2FE>Name</col>." (the league's colour), and script 3226 refills the side
  panel's bar (656:23). `league_reward_points_buffer` (13341) then goes 10 and back to 0 for the
  bar's animation; not sent.
- The journal's Leagues tab (side_journal 629:34) shows once the varbits are set; a click mounts
  the league side panel (656) in the journal's content container (629:43) with the tab varbit
  8168 = 4, the way this client mounts its other journal tabs (live mounted it in its own slot).
- XP: the league's rate (5x; 8x from relic tier 2, 12x from tier 5, 16x from tier 7, Wiki tier
  passives) multiplies every gain after the world's rate, through the can-gain-experience
  hook's `multiplier`; the other tier passives are under "Tier passives" below.

## The content payload

A league's screens read structs, enums and DB rows the rev 241 cache only holds for the current
league (Demonic Pacts): the relic catalog, the task list, Leagues I-III's rank thresholds.
`league/Content.LeagueMode.js` asks every unit for its rows (`league:content-rows`) and sends them
as one `structOverrides` / `enumOverrides` / `dbRowOverrides` payload (`sendContentData`; the
client's `GamemodeContentStore` replaces the whole set on each payload, which is why no unit sends
its own; rows for one struct from several units are merged into one) at a league login and on
`league:send-content`. Virtual struct and enum ids start at 200000 + league type x 1000; the relics
use offsets 0-199, the ranks 900-901. The tasks' DB rows are their own id space (300000 + league
type x 10000 + position) and replace the cache's task enums 5950 and 2671. A league the cache
carries sends an empty payload (Demonic Pacts: no overrides at all), which also clears whatever
another league left in the client.

## Panels

Every league screen opened as the main modal (Summary, Info, Rank, the areas, the relics) does so
in the Leagues VI recordings' wire order (237/01104): varbit `busy` (12393) to 1, an open task list
closed (its close script 9431), script 2524, the modal, its events; closing it, by any route,
sets `busy` back to 0 (`league/Modals.LeagueMode.js`, over `league:modal-opening` { player, group }).
Live kept `busy` at 1 while a confirm's modal waited to reopen; here a close always clears it.

The side panel's three top buttons, each opening its interface as the main modal with the click
events on its menu frame, as captured (227/00075, 227/01845, 227/00579); the client draws the rest
from varps and the league struct, so the server sends nothing else (`league/Panels.LeagueMode.js`,
data `panels`):

- Before each, script 2524 sizes the modal, as live ran it: (-1, -1) for the Summary and Rank,
  (-1, -3) for the Info panel and the relic interface.
- **Summary** (656:7 -> `league_summary` 529): sound 2266, `if_setevents` on the stats row 2 (Time
  Played, OP1 and the six target kinds) and script 7741 `[529:23, 2, "(Click to reveal)"]`; a click
  on that row closes and re-opens the summary with the time played, in the captured shape (the two
  largest non-zero units: "17 days, 2 hours", "17 days, 58 minutes", "19 hours, 46 minutes"), and
  it stays revealed for the session. The time is the character's time online, counted here
  (`league:play-time`, milliseconds, saved every minute and at logout) since the capture has no
  play-time varp. Each of the three asks for the content payload again before it opens.
  Live also ran the account summary's playtime script (3970) on the open; not sent, since that
  panel is not mounted here. The rows read the points and task varps (LeaguePoints), the relic and
  area selection varbits, varp 5484 `talent_points_earned` (Demonic Pacts' masteries, theirs) and
  the statistics below. Every league type.
- **Info** (656:2 -> `league_info` 654): `if_setevents` OP1 on `league_menu_frame` 654:17 slots
  12-18. The panel's texts are the league struct's (the cache's, every league type).
- **Rank** (656:10 -> `league_rank` 64): `if_setevents` OP1 on 64:16 slots 10-18; script 730 draws
  the seven ranks from the struct's threshold enum (param 1857) and trophy enum (2041), the names
  from enum 5201 and `league_points_completed`.

### Ranks

`league/Rank.LeagueMode.js`, data `league-ranks.json`: seven ranks a league (Bronze to Dragon) at
the League Points thresholds the trophies are awarded in. Leagues IV-VI's are the cache's enums
(5237 / 5719 / 5979; the Wiki's League_trophy tables agree, and the test checks it); Leagues
I-III's structs carry none, so their rows are the Wiki's thresholds and the cache's trophy items
by name, sent through the content payload. As captured, varbit `league_rank_notification` 17299 =
the number of ranks reached, sent at login and on the award that crosses a threshold, with one
game message per rank (`<col=229628>You've obtained Iron rank! You can claim your trophy from the
Leagues Tutor in the main game.`); no popup. Trophies themselves (447) are not handed out yet.

### Statistics

`league/Statistics.LeagueMode.js`, data `statistics`: the summary's rows read the `tracking_*`
varps 4510-4527 and varbit 11561; the server counts what its hooks see for a league character,
one attribute `league:statistics` (name -> value), sent at login and as each changes: NPCs killed
(`onNpcDeath`; bosses by the cache's boss param 1361, as NpcDrops reads it), deaths, players
killed (`onPlayerDefeated`), damage dealt to NPCs and the highest hit (each hitsplat's `onApplied` as it lands, attached in
`onCombatHitResolved`, so a cancelled projectile counts nothing),
damage taken from NPCs (`onCombatHitResolved`), food (`food:eaten`), potions (`potions:drunk`),
fish, ore and logs (`fishing:success`, `mining:success`, `woodcutting:success`). Stubbed at 0 for
want of a source: echo bosses killed (none here), coins gained and lost, clues completed (no
completion event), special attacks used (the special flag is cleared before the hit resolves) and
the highest value item worn.

## Tutorial

`league/Tutorial.LeagueMode.js`, data `league-tutorial.json` (generated from the two recorded runs
on new characters: osrs-captures 227/00196 Raging Echoes and 237/01098 Demonic Pacts). A new
league character starts at `league_tutorial_completed` 0; the client draws every page (title,
body, buttons, picture) from the league struct's param 1033 tutorial struct, with enums keyed by
that varbit, so the server only moves the varbit and opens the screens. A character that joined
before the tutorial existed has no stage and counts as finished: the login sends the league's
finished value, 12 (every Raging Echoes capture's login) or Leagues VI's 14 (243 logins sent it).

- **Screens, as captured before every page:** `league_tutorial` (653) in the toplevel's
  `overlay_atmosphere` (161:1) with its click blocker 653:1 shown, `mesoverlay` (263) in
  `chatbox:crmclose` (162:565 in this cache), script 1974 with an empty line, script 2524 (-1, -1)
  and `league_tutorial_main` (677) as the main modal, closed and reopened at each stage so the
  client draws the new page. `orbs_disabled` (4084) and `chatoverlay_allowmesoverlap` (10690) are 1
  while it runs. It opens once the welcome screen's Play is clicked, or the new character's design
  closes. Not sent, though captured: `minimap_toggle` (no such packet here), `side_journal_tab` = 1
  with the quest list mounted on Get Started (this client mounts journal tabs on their click), and
  the orbs interface reopened at the end (this client keeps it).
- **Stages** (Raging Echoes; Demonic Pacts adds 11-13 and finishes at 14): 0 the welcome page, Get
  Started (677:9) sets `league_3_has_seen_cutscene` and jumps to 3; 3 flashes the journal stone
  (`flashside` 3, OP1 armed on stone2 of every gameframe layout: 161:61, 164:54, 548:66) until it is
  clicked; 4 flashes the journal's Leagues tab (script 3162 on 629:42) until the side panel (656)
  mounts, which awards "Open the Leagues Menu" (`open-the-leagues-menu`; a mount at stage 3 counts
  for both steps); 5 / 7 / 9 pulse the Tasks / Areas /
  Relics buttons (script 3185 on 656:35 / 39 / 43, 3186 stops it) and, when the section's screen
  opens, run its walkthrough (6 / 8 / 10); Raging Echoes then waits for an area unlock
  (`league:area-unlocked`) and every league for a relic pick (`league:relic-unlocked`); 11 (13 for
  Demonic Pacts) is Finishing Up, whose End Tutorial (677:8) awards "Complete the Leagues
  Tutorial" (`complete-the-leagues-tutorial`), restores the orbs and closes the screens. Both tasks
  go through the task catalog's `league:complete-task` (its points, list bit and message); with no
  catalog on the server they pay 10 points each through `league:award-task`. Exit
  Leagues (677:8 on the first page) logs the character out (ours: never pressed in a recording).
- **Other plugins' screens:** the task list (657) and the area map (512) belong to their own
  plugins. The tutorial never handles their buttons; it watches for their screen to open through
  the core's `interface:opened` (reacting once the opening plugin has finished, a microtask
  later), and a section whose screen has not opened two ticks after its button was clicked is
  skipped (on a server without the
  tasks and areas plugins, 5 goes to 7 and 7 to 9). Demonic Pacts' pacts section (stage 11, the
  tree 647) runs no walkthrough: its middle step waits for a pact point to be spent in an interface
  this server does not have, so its button goes straight to 13.
- **Always finishable:** besides the skip, a relic picked or an area unlocked before its page counts
  when that page's walkthrough ends (the relics' `league:relic-unlocked` state, the area selection
  varbit 10663); the page or a section's screen closed half way (Escape, walking away) brings the
  page back a tick later unless another screen replaced it, and the walkthrough starts again when
  the screen is reopened (a walkthrough already seen this session is not shown twice); a relog
  resumes at the page of a walkthrough stage.
- **Walkthroughs** (`plugins/interface/ScreenHighlight.plugin.js`, usable by any content): the
  cache's `screenhighlight` (664) in the screen's `tutorial_highlight` layer (657:14, 512:13,
  655:13) with OP1 on Continue (664:31) and Previous (664:32) slot 9, script 3408, the varbits
  `hnt_selected_hint` / `hnt_hint_step` / `hnt_hint_max_step`, and per step a box (3409) or a
  framed component (2463) and its text (3413 or 2465), with the arguments, texts and colour (the
  league struct's param 1027) each recording shows. The pause button live also arms (664:9) is not:
  its resume packet reaches this server as a dialogue continue. On this web client the first click
  after a step redraws can go to the component that was under the pointer before; a second click
  (or any mouse move first) reaches Continue.
- **Per league:** Raging Echoes and Demonic Pacts are as recorded. Trailblazer Reloaded and
  Trailblazer use Leagues V's tutorial struct (747), whose text this cache writes for Leagues V, so
  they get copies of its title and body enums with their own name through the content payload, and
  Raging Echoes' walkthroughs with their name. Twisted's struct has no tutorial and Shattered Relics'
  is a different flow (its class choice), so neither starts one.

## Welcome screen

`league/Welcome.LeagueMode.js`: on a league world the welcome screen's message of the week
(`welcome_screen:motw`, 378:6) reads, as captured, `Welcome to Old School RuneScape: <league>!`
and, when world.json's pluginConfig `league:end` (an ISO date) is set, `There are N days remaining
in this League.` WelcomeScreen emits `welcome-screen:shown`.

## Records

`league/Records.LeagueMode.js`: the main game's league screens, as captured on rev 229
(osrs-captures 229/00690-00702). Each opens as the main modal after script 2524 (-1, -1).

- **Points:** at a main character's login on a plain world, the account's league save is read
  through the persistence backend. LeaguePoints totals its tasks (`league:saved-points`), and the
  total goes out as that league's main-game varp (2771, 2772, 3275, 4032, 4556 or 5507, the ones
  script 9462 reads). An account keeps one league character, so the other leagues read 0.
- **Trophies (447):** the Leagues Tutor's Claim-trophies, its conversation's open_interface
  "League trophies", and `::leaguerecords trophies` open it. The setevents cover OP1 and OP10 on
  447:3, and script 1128 takes the title and five masks over enum 2778's trophies. A set bit shows
  Take, a clear one Store. The client hides a trophy above the league's points (script 1129).
- **Take and Store:** a trophy is the Tutor's to hand out while the character holds none of it in
  the inventory, equipment or bank (a bank placeholder doesn't count), so a lost one can be taken
  again (Wiki "League trophy"). Take hands out an earned one; Store takes it back from the
  inventory. Each click resends the masks through script 1130, and op10 examines. A click with
  the screen closed does nothing.
- **Accomplishment scroll (41182):** League-statistics opens 449 with script 1110 (the owner's
  name and each league's points). League-rankings opens 445 and nothing else. League-firsts opens
  676 with script 3698 on the newest league, with OP1 on one dropdown slot per league; a pick
  redraws that league. Rankings and firsts are the cache's own tables.

On a league world none of this applies: the Tutor's Claim-trophies and the scroll's options fall
through to their defaults. Bots and agent players never read a league save.

## Reward shop

`league/Rewards.LeagueMode.js`: the Leagues Reward Shop (`league_rewards`, 658), as captured on
league worlds (osrs-captures 227/00100, 02120, 237/01098).

- **Stock:** the cache's. Each league struct lists its reward structs in param 87, with the name
  (363), item (150) and cost (151). A set (the Relic Hunter outfits, six ornament kits) lists every
  item it gives in the enum param 915 names; param 2068 is how many of the item a set-less reward
  gives. The client draws every league's rewards, rows running across the leagues in order; this
  cache has 65, as rev 237 did.
- **Opening:** the Leagues Tutor's Trade (main game) and Rewards (league world) options, the
  conversations' open_shop "Leagues Reward Shop", and `::leagueshop`. It sends script 2524 (-1, -1),
  the modal, and OP1 on 658:9 over one slot per reward. The Bank PIN guards it first.
- **Buying:** a row click sets `league_rewards_shopselection` (10110) to the row. Confirm (658:22)
  sells the selected reward in the main game, if the points left cover it and the inventory has a
  slot for each piece. The points left are each league's points (Records) less what the character
  spent of them (`league:reward-points-spent`, by league type), sent as varp 2613. Confirm's click
  shows a loading layer (658:24) no script hides, so the shop closes and opens afresh a tick later.
  Closing the shop forgets the selection.
- **League worlds:** the shop opens to browse. Live sends no points there, and the client hides
  Confirm where the league struct's param 2053 says so. A Confirm that reaches the server gets the
  client's own line, "You can purchase these rewards on a Non-Leagues world."

The Wiki pools every league's points. This server knows one league per account, the one its league
character played. On this server's NPC spawns only `::leagueshop` reaches the shop: the one Leagues
Tutor spawned (315, Lumbridge) has neither Trade nor Rewards.

## Shattered Relics

Leagues III's own screens (`league/Shattered.LeagueMode.js`, `Fragments.LeagueMode.js`,
`Unlocks.LeagueMode.js`, `Sage.LeagueMode.js`, `NearBank.LeagueMode.js`, data
`league-shattered.json`). No recording exists (the league ended in
March 2022, before the captures' rev 223), so every packet is from the cache's scripts and every
rule from the Wiki's Shattered Relics pages. They draw only for league type 3 (varbit 10032).

- **Side panel (736):** the journal's Leagues tab mounts it instead of 656
  (`journal.sidePanelByLeague`). It draws points, tasks and Sage's Renown from varps. Its Info
  button opens the Info panel, Tasks emits `league:open-tasks` for the task list, and Fragments and
  Unlocks open their screens.
- **Sage's Renown:** `league:renown`, sent as varp 3276. A task award pays its tier's renown, read
  from its points (Wiki /Tasks: 5 points pay 1, 25 pay 2, 50 pay 3, 125 pay 4, 250 pay 5). Other
  amounts pay none. `::renown <amount> [player]` grants it too.
- **Class choice (737):** at the first login, and every login until chosen. Select sets varp 3345
  so the client shows that class's confirm panel. Accept unlocks its combat skill (script 5830's
  varbit), gives its fragment at level 1 and its items. 737 names the items; their amounts are this
  server's choice. Items that don't fit the inventory go to a bank tab with room; with no room for
  the whole kit, Accept gives nothing and the class stays unchosen.
- **Fragments (735):** owned fragments (fragment XP, varbits 13403-13455) and the seven slots
  (varbits 13395-13399, 13401, 13402) are saved. Slots open at the points enum 4127 gives. Equip
  puts an owned fragment in the first open empty slot, never twice; Unequip and Unequip all clear
  them. The screen opens anywhere, but fragments change only in a bank, near a bank chest or near
  the Sage (Wiki /Fragments): within 8 tiles of a loc with a Bank option (booths, counters, tables;
  a closed booth has none), a usable bank chest or an NPC with a Bank option (bankers of any name),
  or of the Sage. The Wiki gives no distances, and no message for elsewhere; both are this
  server's.
- **Fragment XP:** each equipped fragment gains 1 XP for any XP gained in an unlocked skill, at
  most once every 4 ticks (Wiki), through the core `onExperienceGained` hook. Levels 2 and 3 come
  at 2,000 and 8,000 XP (script 5789), where a fragment stops. A set's tier counts the equipped
  fragments that list it (enum 4137: 2 or 3 pieces).
- **Drops:** a skill's XP may turn up its category's Unidentified fragment, the likelier the more
  XP; a kill may turn up the combat one, by the NPC's hitpoints, carrying the NPC's tier on the
  item (the Wiki's boss lists; any other NPC tier 1). Break opens it into a fragment not yet
  mastered whose own item it is (enum 4136 param 1462), for combat of its tier (param 1454) or the
  nearest with one left: new at level 1, or 500 XP for one already owned (Wiki). The rates are this
  server's; misc fragments have no listed source, so only `::fragment` gives their item.
- **Effects (batch 1):** Unholy Warrior / Ranger / Wizard (accuracy at 0 Prayer points),
  Bottomless Quiver (ammunition and bow charges saved, through the core `combat:ammo-saving`),
  Arcane Conduit (runes and powered-staff charges), Larger Recharger, Divine Restoration,
  Venomaster (poison on hit, poison and venom immunity), Slay All Day, and the sets Absolute Unit,
  Drakan's Touch, Twin Strikes, Double Tap and Chain Magic. Each fragment works with the number
  its level gives in the cache (params 1456-1458; Venomaster's are poison severities 15/25/35,
  hitting 3/5/7); the sets' numbers are only in their texts. Venomaster's chance (25%) is this
  server's, and its immunity stops new poison without curing a running one. The extra rolls are
  rolled with the hit's own spell, never a special attack, and pay XP like any hit, for no more
  than the hitpoints left after the damage already queued (none after a killing blow). The per-tick
  effects run as one task per Shattered Relics character, from login.
- **Effects (batch 2):** Tactical Duelist (melee weapon charges saved: the scythe of vitur, the
  crystal halberd and Arclight ask `combat:melee-charge` before spending one), Livin' On A Prayer
  (the core `registerPrayerDrainRateModifier` scales what active prayers add to the drain counter
  each tick), Special Discount (the core `registerSpecialEnergyCostModifier`, which every energy
  check and `CombatSpecial.drain` use; the cache's 500/400/250 are tenths of a percent; the Dragon
  hasta's Unleash spends all energy, which isn't its cost, so it isn't capped), Thrall
  Damage (`magic:thrall-max-hit`, asked on each thrall attack), Superior Tracking
  (`slayer:superior-spawn`; this server reads its text, which names no unlock, as working without
  Bigger and Badder, but never once superiors are toggled off), Slay 'n' Pay (`slayer:task-reward`'s multiplier,
  Mortimer's too), the god-armour four, and the sets Fast Metabolism (each Hitpoints regen heals
  four times as much, through `stats:hitpoints-regen`) and Knife's Edge (every style's max hit, in
  permille so it stays exact). The god-armour four need four worn items of their god, counted as
  the God Wars Dungeon counts protection (`godwars:god-items`, so a godsword counts): Bandosian
  Might adds its number to the melee max hit per tick of the weapon's attack speed, Zamorakian
  Sight raises magic accuracy, Armadylean Decree raises enchanted bolt chances
  (`combat:bolt-effect-chance`, after the Kandarin diary and the Armadyl crossbow's special), and
  Saradominist Defence adds to every style's max hit for 6 ticks after combat damage from an NPC
  or player lands (poison isn't a hit, so it never counts; nor does a boss's scripted damage that
  skips the combat hit). Max hit bonuses add before Knife's Edge multiplies. The god-armour count
  is God Wars' protection count (the Wiki's tables, so god books, symbols and blessings count too);
  magic specials with a fixed max hit skip both max hit
  bonuses, as they skip every magic max hit modifier.
- **Gathering effects** (`league/FragmentGathering.LeagueMode.js`, data `gatheringEffects`): the
  harvesting fragments, Message In A Bottle, Greedy Gatherer and Personal Banker, through the
  skills' own events. Chef's Catch cooks a caught fish (`cooking:cooked`), Molten Miner smelts an
  ore into the bar whose main ore it is (`smithing:bar-for-ore`; coal makes nothing) and Slash &
  Burn burns a log (`firemaking:log-xp`), each with that skill's XP whatever its level. Greedy
  Gatherer brings two or three of each Mining, Woodcutting, Fishing and Farming resource with the
  XP of each, and Personal Banker banks them at 50% or always (then a full inventory gathers on).
  They compose on one resource: the fragment's change to every piece, the extras, then the bank or
  the inventory; extras go to an open container (a fish barrel, a log basket) first and fall to the
  floor when nothing has room (ours). What a container took of the resource itself stays as it was
  gathered (the containers hear `storage:gather` first), and a changed item the bank has no room
  for is banked as gathered, without the change's XP. Farming's extras never take the room the pick
  itself needs; a Fishing Trawler trip is no catch for Catch Of The Day. Farming's harvest (`farming:pick`, now with the pick's `experience` and
  a `stored` count) is noted and maybe doubled by Certified Farmer; Seedy Business keeps a seed
  (`farming:plant-rules`); Rock Solid keeps iron, sandstone and granite standing
  (`mining:deplete-rock`); Homewrecker makes Woodcutting's bird nests 2-4 times likelier and banks
  them (`woodcutting:nest-chance`, `woodcutting:nest-drop`); Message In A Bottle multiplies the
  clue nests, geodes and bottles (`treasure-trails:vessel-chance`); Catch Of The Day rolls
  NpcDrops' rare drop table once (`npc-drops:roll-table`) on a 1-in-N catch; Chinchonkers adds
  Hunter XP for a chinchompa and two of them at level 3 (`hunter:rewards`). The banked nest and
  rare catch messages are this server's.

- **Production effects** (`league/FragmentProduction.LeagueMode.js`, data `productionEffects`):
  the production fragments, The Alchemist, The Craftsman and Unchained Talent. The two
  all-at-once sets answer `skills:actions-per-cycle` with the inventory (28) for the Wiki's
  activities only (The Alchemist: cooking, cleaning, mixing; The Craftsman: smelting, smithing,
  cannonballs, leather, glass, uncut gems, pottery, battlestaves, spinning, fletching logs (bows
  and shields) and bolt tips). Unchained Talent keeps the non-combat skills 8 over their level, checked every tick
  (`league:fragment-tick` from the fragment task), and takes the boost off with the set; Sailing,
  which the league predates, is left out (ours). The fragments hear `skills:produced`, which now
  carries the loop's `kind` (and `materials` for leather and jewellery): Smithing Double (an anvil's
  product again with its XP, falling when the inventory is full), Imcando's Apprentice (gemmed
  jewellery again with its XP, only with room), Dragon On A Bit (dragonhide armour's leather back
  to the bank), Dine & Dash (another cooked food to the bank, no XP, never untradeable food or in an
  instance), Profletchional and Just Druid! (more XP for logs and stringing, and for cleaning),
  Pro Tips (more bolt tips a gem, rounded down: ours). Mixologist answers `herblore:mix` (a potion
  from an unfinished one with four doses; its secondary kept at the Wiki's 20/50/100%), Rooty Tooty
  2x Runeys `runecrafting:success` (each rune its chance of another, Guardians of the Rift's altars
  too), Plank Stretcher `construction:materials` (a build's planks kept: hotspots, staircases and
  the workbench's flatpacks, through House's `useMaterials`), Enchanted Jeweler
  `magic:enchant-pieces` (jewellery only, not a quest's enchanted rod or sickle),
  Rumple-Bow-String `magic:spell-batch` (Spin Flax) and Alchemaniac `magic:alchemy-policy` (High
  Alchemy only, by the policy's new `high`).

- **Skilling effects** (`league/FragmentSkilling.LeagueMode.js`, data `skillingEffects`): the
  skilling fragments and Clued In. Praying Respects buries and scatters the remains a kill drops
  through Prayer's own `prayer:bury` (which now scatters demonic ashes too) at 50/100/200% of their
  XP, and takes them off the drop (`npc-drops:roll`; NPC drops only: ours), leaving remains above
  the player's Prayer level and the long and curved bones kept for Construction (ours). Smooth Criminal raises
  Thieving's own pickpocket chance by its percent, stacking as the gloves of silence do, and from
  level 2 stuns without the damage (`chanceBonus` and `painless` on `thieving:pickpocket-target`).
  Deeper Pockets doubles the loot through `thieving:loot`'s new `multiplier`, which Thieving's
  own handover multiplies with the rogue outfit's (a pouch's coins come directly; a clue never twice). Hot On The Trail gives
  the Wiki's tier of scroll box for the log lit (`firemaking:success`, and `league:log-burnt` for
  Slash & Burn's logs) while the clue capacity allows another (`treasure-trails:can-receive`); logs
  the league predates give none (ours), and Wintertodt's bruma roots and kindling, fed to its
  brazier rather than lit, never do here. Golden Brick Road puts its coins beside a mark of grace
  (`agility:mark`). Grave Robber raises a coffin's hallowed marks, the Grand Hallowed Coffin's too
  (ours), through the minigames' `minigame:points` (tier passives, below); a part mark is that chance of a whole one. Clued In makes each clue scroll an NPC drops
  at least 1 in 30/25/15 (`npc-drops:tertiary-chance`). The scroll box message is this server's.

- **Minigame effects** (`league/FragmentMinigames.LeagueMode.js`, data `minigameEffects`):
  Barbarian Pest Wars (Pest Control's commendation points and Soul Wars' zeal tokens), Rogues'
  Chompy Farm (the Tithe Farm's points; a chompy kill counted 2-4 times on the ogre bow's count)
  and Mother's Magic Fossils (the Mage Training Arena's pizazz points earned in its rooms; the
  Motherlode Mine's golden nuggets and Fossil Island's unidentified fossils, from drift nets and
  the Volcanic Mine, likelier) pay x2/x3/x4, through the
  minigames' `minigame:points` (tier passives, below) and new `minigame:chance`, and the quest's
  `big-chompy-bird-hunting:kill-credit`.
- **The Sage's items** (`league/FragmentSage.LeagueMode.js`, data `sageEffects`): Endless
  Knowledge, Last Recall and Trailblazer give the item their set struct names (param 1471: the
  Arcane grimoire, the Crystal of memories, which this cache calls Crystal of Echoes, and the
  Portable waystone), handed over when the set becomes active (`league:fragments-changed`, from the
  fragments screen, and at login) to a character holding none (in the inventory, worn, banked
  rather than a placeholder, in its grave or at Death's Office), into the inventory, else the bank,
  else the floor; the Wiki has the Sage give it (ours). As with the grimoire's own unit (Leagues polish), holding it is
  the token, so it keeps working when the set comes off. The crystal's Teleport-back returns to
  where the character's last teleport began, from the core's new `teleport:landed` (`from`,
  `fromInstance`), unless that was in an instance, Fossil Island's underwater area, Entrana, the
  rune essence mine, Pyramid Plunder or the Agility Pyramid's upper floors (the Wiki's exclusions
  this server has; boxes ours), up to Wilderness level 20 (ours); Check-memories says whether one
  is kept, and Save-memory that it keeps itself. Every teleport counts, the crystal's own too, so a
  second Teleport-back returns to where the first was used. Home teleports, fairy rings, spirit
  trees and Wilderness obelisks move the player themselves and send the same event. The waystone's Teleport lists the league's twelve
  waystones in pages, not past Wilderness level 20, Canifis needing Priest in Peril and Prifddinas
  Song of the Elves; the tiles are this server's (the Wiki names only the towns).

- **Unlocks (733):** skills, bosses and quest packs bought with renown, at the cache's prices for
  skills and bosses. Quest packs have no price in the cache: each pack's varbit holds its price
  now, from the Wiki's Initial Cost less the prerequisite packs already unlocked, and 0 once
  unlocked. Buying a pack unlocks its prerequisites. Defence, Fishing and Thieving start unlocked.
  Nex can be bought only once every God Wars general is unlocked.
- **Quest packs:** bought only in a bank (the launch news: "you can only auto-complete quests while
  in a Bank"; the same check as the fragments', `NearBank.LeagueMode.js`, before any renown is
  spent; the message is the news's wording). Buying one completes the quests the Wiki's /Unlocks
  table lists for it (main and additional quests) and for its prerequisite packs, each through its
  own `quest.complete` (quest points, final rewards, the message, `quest:completed`), prerequisites
  first. The Wiki: "Auto-completing quests will not grant the experience", so `complete(player, {
  experience: false, scroll: false })`: no XP lands while they complete, a reward's later XP prompt
  is held back (The Fremennik Isles reads the option), and the rewards that are XP in an item (the
  lamps and Tomes of Experience in `experienceItems`, found by completing every pack) are taken
  back. The quest runtime saves which quests were completed so (`quest.experienceWithheld`, the
  attribute `quest.experience-withheld`), and their post-quest XP claims pay nothing: Ellen's
  training (Dragon Slayer II), Daero's (Monkey Madness I; the Wiki: "No post-quest XP from Daero"),
  Lydia's lamps (A Kingdom Divided), Veos's lamp (X Marks the Spot) and Ivan's tome (Sins of the
  Father). There is no jingle or scroll per quest, so the unlocks screen stays open. Each quest
  runs against an empty inventory; the character's own comes back, and the rewards go into it,
  then the bank (counting what the bank really takes: a full bank or a capped stack takes less),
  and what neither takes is dropped at the character's feet, as a quest reward past a full
  inventory is (`forceAdd`). The other final rewards stay (Plague City's Ardougne teleport scroll,
  Monkey Madness II's royal seed pod, Roving Elves' crystal bow, Drakan's medallion). A quest that
  fails to complete is logged and the rest go on. Names this server registers no quest for are
  skipped: Recipe for Disaster's subquests (its plugin keeps them internally, with no completion
  API) and the miniquests (Alfred Grimhand's Barcrawl, The Frozen Door, Architectural
  Alliance). Enter the Abyss is a registered miniquest, so Temple Knight II completes it. The packs' other content (Kourend favour, the Camelot training room's
  waves, Troll III's fire pits) isn't given.
- **The Sage (NPC 11232):** a world running Shattered Relics spawns it at Catherby (2774, 3433,
  the Wiki's map; the main world's spawns don't have it). Talk-to plays its transcript. Its "Do I
  have any League items to collect?" (the transcript's two conditions and its "You receive an item
  from the Sage." action) and Collect-items hand over what the unlocked packs let a character
  claim (Wiki /Unlocks): Gnome I the Karamjan monkey greegree, Elf I Iban's staff, Elf II a new
  crystal bow or shield (a menu), Morytania II Drakan's medallion, Fairy I magic secateurs and a
  Dramen staff, Heroes ice gloves. Only what the character owns none of, carried, worn or banked
  (a bank placeholder doesn't count): a lost one can be collected again, as the transcript's "I'll
  be here if you ever do" has it, and one a quest's own reward already gave (Drakan's medallion,
  Roving Elves' crystal bow or shield) isn't given twice. Collecting again after alching or
  selling one works too (Iban's staff alchs for 25,500); live's rule there isn't recorded.
  Check-pets and the transcript's "League Intro cutscene replays." do nothing.
- **Intro cutscene (734):** not built, because the cache can't drive it. 734 is a layer of static
  models (43335, five of 43342, 43334), an empty text, a rectangle and a Mute / Unmute Music
  toggle (scripts 5836-5838, which only set game option 7 and swap the two buttons). No script
  animates or moves the models except 5835, which nothing in the cache calls and which only places
  734:12 and turns 734:5 once; no script reads `league_3_has_seen_cutscene` (varbit 13488). The
  sequence (the River of Souls, the Sage's lines, model animations and camera) was the server's,
  and no recording of it exists, so playing it would mean inventing it.
- **Locks:** a locked skill gives no XP, and a locked boss can't be attacked, by the player or its
  thrall (its NPC names are in the data, raids by their final boss). Kraken's Disturb and Vorkath's
  Poke ask `league:boss-locked` before waking them. Wintertodt and Tempoross aren't attacked, so
  their locks aren't enforced, and instance entries (Zulrah, the Gauntlet, raids) aren't refused,
  only the fights inside. The Wiki gives no message for either lock; the boss one is this
  server's, said once per boss every few seconds.

Not yet: Barbarian Assault's honour points and the Rogues' Den safe, which this server
doesn't have; Rune Escape, which needs the Ourania Altar this server doesn't have; Plank
Stretcher outside a house build, as Mahogany Homes; the ranged weapons' own charges, which
no hook reports; the league's waystone objects themselves (only the portable one's teleports
are here); The Alchemist's jugs of wine (no wine making here). Fishing has no clue bottles of
its own, so Message In A Bottle reaches only Hunter's aerial fishing and drift nets for bottles.
Fragments change only through Equip (dragging one into a slot isn't handled); the Display
Fragments toggle (varbit 12383) is the client's own. The intro cutscene (734) has no recording
or client driver, so it isn't played. Unlocking Herblore doesn't yet complete Druidic Ritual
and set the skill to 174 XP (Wiki /Unlocks footnote); the Sage's Check-pets remains unimplemented.
A quest the character had started keeps its quest items when a pack completes it.


## Relics

`LeagueRelics.plugin.js`, data `plugins/modes/data/league-relics.json`: eight tiers a league,
each with a point cost, a passive and three relics (Wiki); a tier's pick is permanent. A
character's picks live in `league:relics` (tier index -> slot 1-3).

On this cache (rev 241, as the Leagues VI recordings 237/01098, 01102, 01104 show) the unlock is
`confirm_button` 655:51 (rev 227's confirm_text 50 has no op now), the open adds IF_SCRIPT_TRIGGER
(bit 23) on `toggles` 655:38 (the relic effect toggles), script 3193 takes rev 237's components
and, after the two structs, the relic's description and the tier's passive text, and 3181's
tooltip is 655:53.

- **The catalog.** The cache's relic interface (655) reads the league struct's tier enum (param
  870), tier structs (877 cost, 878 relic enum, 2045 passive struct) and relic structs (879 name,
  880 description, 885 tier, 1855 has-item), but the cache only carries the current league's.
  The server sends a league's own as `structOverrides` / `enumOverrides` datasets through the
  content payload above (`GamemodeContentStore` and the cs2 `struct_param` / `enum` ops read them
  before the cache) at login and before the interface opens. Ids start at 200000 + league type
  x 1000; icons are borrowed from the cache's own relic in the same tier and slot. Demonic Pacts
  (`"6": { "fromCache": true }`) is read from the cache instead: its tiers, costs, passives and
  relics come from struct 6436's enums, the relic keys are their names slugged, and a relic's
  item is its struct's param 2049 (param 1855 says it has one); such a relic unlocks only in a
  bank or near the Leagues Tutor ("You must be within a bank or near the Leagues Tutor to unlock
  this as it gives you items.", 237/01102), then the captured line and a "You receive ..." box.
- **The flow, as captured.** The side panel's View Relics (656:44) opens 655 as the main modal
  with `if_setevents` on its slots (655:22, 0-23) and menu (655:6, 10-20). A slot click sets
  `league_relic_last_viewed` (10048) to tier x 3 + slot and runs the client's redraw scripts 3193
  (the panel's components, the relic's state, the relic struct, the tier's passive struct) and
  3181. The state is what the client's buttons and toggles read: 1 the character's own relic
  (237/01104; it also unlocks the relic's effect toggles, which refuse with "You need to have that
  relic unlocked in order to toggle its effects." otherwise), 4 another relic of a chosen tier
  (Reloaded's extra pick aside), 0 a tier the points don't reach, 2 one to choose.
  Known issue: on this web client the relic information panel stays blank after those two
  scripts (`extra_info` 655:27 remains hidden, for data-driven and cache-native leagues alike;
  every component id was re-checked against the rev 241 gamevals and the scripts run without a
  cs2 error), so the pick is only reachable through `::relic` until the client's cs2 side is
  fixed. Confirm (655:50) unlocks the viewed relic: its tier's selection varbit
  (10049-10053, 11696, 17301, 17302) = the slot, animation 8524, the league's unlock graphic
  (struct param 1021: 2603 Trailblazer Reloaded, 3044 Raging Echoes) at height 92, the modal
  closed, sounds 4215/4211/4213/4212 at 8/44/80/104. Points crossing a tier's cost show "New
  Relic Available!" / "You've gained enough points to unlock a tier N Relic!" with jingle 281, in
  the orange the capture shows on a Raging Echoes world (the task popup, by contrast, uses the
  league's colour). Slot and confirm clicks count only after View Relics opened the interface.
- **The checks.** A league character, a real slot, no pick in that tier, the tier's points, a
  bank open when the Wiki says the relic must be unlocked in one (`requiresBank`: every
  Trailblazer Reloaded item relic; Raging Echoes' Clue Compass, Bank Heist and Fairy's Flight,
  while its tier-1 tools are handed out anywhere, as the Leagues V tutorial's Animal Wrangler
  unlock in osrs-captures 227/00196 shows; the modal replaces the bank as the main interface, so
  what was open when View Relics was clicked counts), and room for every item in the inventory
  or a bank tab, so a permanent pick is never saved without its items; the room check is
  item-aware (a stackable item joins its inventory stack, an item already banked joins its bank
  stack and needs no slot, a new bank stack takes one slot of the player's bank space, which
  every tab shares, and a slot one item takes is not counted for the next), and each item
  goes where that check placed it: the inventory if it fits, else the bank tab holding it, else
  its tab or any tab with room. Refusals are game messages of ours. Items no longer in this cache (Sage's greaves, the Trailblazer tools, the crystal of
  memories, the guardian horn) are not granted; the data says so.
- **Effects** are other plugins' business: they ask `league:has-relic { player, relic }`, true
  only when the character's league has that relic and chose it. The tier passives are
  LeagueMode's (`league:highest-tier`), under Tier passives below. The relics this
  plugin implements itself are units `leaguerelics/<Relic>.LeagueRelics.js`, gated by
  `Common.effectActive(player, effect)`: the effect's `league` (a type, or several for a relic
  both leagues have) and its `key` (or an alias: the catalog's `last-stand-preview` and
  `treasure-seeker-preview` stand in for relics the Wiki lists once; #1324 pads those tiers).
- **The catalog's padding.** The Wiki gives Trailblazer Reloaded's tiers 2 and 3 and Raging
  Echoes' tier 6 two relics each; the catalog fills the third slot (`crystal-of-memories`,
  `treasure-seeker-preview`, `last-stand-preview`). The previews get the real relic's effect.

### Demonic Pacts' relics

Each unit's head gives its hooks and what it leaves out; the relic toggles (655:38's script
triggers) are `Toggles.LeagueRelics.js`, over the cache's `league_relic_effect_toggle` rows and
varp `league_relic_effect_toggle_1` with the recorded "Relic - ..." lines (237/01104).

| Tier | Relic | State |
| --- | --- | --- |
| 1 | Endless Harvest | done (Trailblazer Reloaded's unit; banking by toggle, resources never deplete) |
| 1 | Barbarian Gathering | partial: second chance, Strength/Agility XP, bare hands that fish without bait (`fishing:tool`) and chop and mine as the crystal axe and pickaxe (`woodcutting:tool`, `mining:tool`); not the Knapsack's storage: its Fill, Check, Open/Close and Dispose (and the bank's Empty) have no recording and no line in the Wiki, and no Leagues VI recording carries the knapsack |
| 1 | Abundance | done |
| 2 | Hotfoot | partial: cooked fish, smelted ore, running XP in the boots (10 + floor(Agility x 2/3) every 10 ticks of 2-tile moves, Wiki: Searing boots), laps counted twice with +25% XP, no failures, a 33% mark chance on the nine rooftop courses (`agility:mark-chance`; the mark cooldown still runs), a picked-up course mark finishing the lap with 10,000 coins (`agility:mark-taken`), Prifddinas's portal shards tenfold (`agility:course-item`; the portal's own shard and line, 237/01149, are new to the course), the Brimhaven arena's tickets and vouchers twofold (`minigame:points`); not termites finishing a lap or doubled (the Colossal Wyrm courses give no termites: their spawn rate is unknown, Wiki) |
| 2 | Friendly Forager | partial: Raging Echoes' unit, plus Herblore at once and 100 of each herb (Wiki, 15 April 2026); the recorded lines. Not the worn Withdraw-all and Withdraw-last (their behaviour is in no source), nor the herb sack's shared store (Wiki: it shares the silklined herb sack's) |
| 2 | Woodsman | partial: Fletching batches, log burning, Hunter catches, impling loot doubled and noted (`hunter:impling-loot`), double rumour XP and sack loot rolls (`hunter:rumour-reward`, `hunter:sack-rolls`), whistles that keep their charges (`quetzals:whistle-charge`); not the trap's herb or tree seed: the Wiki says only "a random herb seed or tree seed", and no Leagues VI recording has a Woodsman holder (every trapper in them chose Friendly Forager) |
| 3 | Bank Heist | done |
| 3 | Evil Eye | partial: the Wiki's 60 bosses and raids by area, each on the entrance tile the server's own data gives (`league-evil-eye.json`), with the eye's recorded cast (evil_eye_cast01, leagues_6_evil_eye, the move 4 ticks on, varp league_default_teleport_last_destination; 237/04057); not live's menus (interface 187 "Select a region", locked areas struck through, "Evil Eye teleports - <area>" with live's labels and Back): the recordings give only five areas' lists |
| 3 | Map of Alacrity | partial: 57 of the Wiki map's 141 shortcuts, those the server has with a side the pin and the data agree on (`league-map-of-alacrity.json`, which lists the rest and why), the Agility level and the Wiki's quest notes; the league's area-teleport cast |
| 4 | Transmute | done: Alchemic Divergence and Convergence (218:199, 218:200) move up to 10 of an item a tier along the cache's `transmutation` table, 10 Magic XP each, no level or runes, every 5 ticks, a stack cast on again while its slot holds it, noted stays noted, to the bank by toggle, loose items in place with a slot each (237/01102, 01106, 238/04211); the alchemy spell while toggled off; the ledger's endless nature runes and its scroll for an item used on it; not Divergence on a top tier (unrecorded), the ledger's Read (nothing says what it shows), or which skilling pauses the casts |
| 4 | Conniving Clues | done |
| 4 | Butler's Bell | done but for the bell's Check (its line is in no source): Ring summons the Demon butler beside its owner (not in an instance; in view, he asks to be spoken to), one job of the cache's butlers_bell_actions at its rate a minute or half that processed, rolled on the Wiki's weighted tables, reckoned from the clock (offline too), 10 XP a processed item in the row's skill; Talk-to and Collect as the Wiki transcript, the collection shown on 954. Ours, unsourced: the job menu (the cache's nouns), where he stands and when he leaves, the collection banked (`league-butlers-bell.json` `_ours`) |
| 5 | Nature's Accord | partial: noted yields, undying crops, kept seeds, the Fairy mushroom, no Farming level to plant, make a seedling or a scarecrow (`farming:level-rules`); not the spirit tree count, the Tithe Farm's seeds, or Tree Gnome Village on unlock |
| 5 | Larcenist | partial: sure pickpockets, tenfold pouches and noted loot, repeats, stalls that stay stocked and guards that never catch you (`thieving:stall-watch`); not the Varlamore house valuables: house thieving (stealing valuables) is not on the server, a minigame of its own |
| 5 | Soul Harvest | partial: shards from bones, ashes (our 0.8 x XP; the Wiki gives none), crops and health checks (`farming:check-health`), bound as pure essence (`runecrafting:essence`); not the libation bowl: the Teomat's bowl (Fill, Sacrifice, Check) is not on the server, and the soul-shard sacrifice's lines and pace are unrecorded (the bowl's 164 recorded uses, 237/01104 and 04054, are Larcenist players with blessed bone shards); nor the Ourania, combination or minigame altars |
| 6 | Grimoire | done (every prayer as well) |
| 6 | Eternal Sustenance | done |
| 6 | Culling Spree | partial: free perks, elite clues per superior, a 50% second superior (`slayer:superior-again`), the Slayer helmet (i)'s boosts and protection unworn (`slayer:helmet`); not the three-task choice with a chosen count (5-200): no Leagues VI recording has a Culling Spree holder, and the cache's slayer_task_choice (236) shows a master's fixed ranges, not a chosen count, nor the helmet uses that read the worn item (Nex's gas, the equipment screen) |
| 7 | Flow State | done but for stealing valuables (not on the server) and diabolic worms (no Fishing spot uses them here): a 2-tick pace for Fishing, Mining, Woodcutting, Cooking, Firemaking (lighting, campfire tending), bone offering, Fletching, Smithing (furnace, anvil, cannonballs: the Wiki's current list), Crafting, Farming (raking, harvesting), alchemy, Superheat Item, enchanting and transmutation (`skills:action-interval`), Wintertodt's root chopping and fletching and brazier lighting, Tempoross's harpooning, with a fletching knife's tick off after it (1 tick) |
| 7 | Reloaded | done (a pick from tiers 1 to 6) |
| 8 | Executioner | done: the execute (never Yama or the Gemstone Crab) and the axe's 6 tiles of reach for its owner, 8 on Longrange (`onCombatAttackDistance` over the profile's 5, 7 on Longrange: its `longRangeFightType`; Trailblazer Reloaded's stays 5 and 7) |
| 8 | Minion | partial: Blow summons the minion (league_guardian) for 30 minutes with the recorded melee spawn and the client's buff timer (league_guardian_active, map_clock), Banish; it follows and fights its owner's NPC (never a player, Yama or the Gemstone Crab) every 3 ticks in the target's weakest style with that style's recorded looks, attack roll 45,000, 3 to 10 +2 a unique Zamorak item fed to the whistle (up to five, the Wiki's list by id); a thrall's pursuit and reach (ours). Not the AoE (no source gives its reach), the auto-loot and its settings (the whistle's Rules and Check are unrecorded), or any message (no Demonic Pacts recording of the whistle) |
| 8 | Flask of Fervour | done: explosions 1, 3 and 5 ticks on with the recorded impacts (237/01158), 30% to players the area lets the owner fight; the buff bar's cooldown varp as the map_clock tick it ends on (the clock + 301 on Activate, each cut, at login), now that core sends map_clock every tick |

### Not in this cache

No unit, and the data says so: the **Guardian** of both leagues (no guardian horn, and a thrall
with its own combat would be a feature of its own), **Infernal Gathering** (no Trailblazer tools),
the **Crystal of Memories** entry (no item), **Ruinous Powers** beyond the book it grants (the
server has no Ruinous Powers prayer book), and the Sage's greaves of **Trickster** and **Corner
Cutter** (the rest of those relics is another PR's).

### Trailblazer Reloaded's combat relics

These relics have their effects (`leaguerelics/*.LeagueRelics.js`, numbers in the data's
`effects`; the Wiki's, as no recording of Trailblazer Reloaded exists):

- **Superior Sorcerer** (tier 4): magic attacks every 2 ticks (the new `onAttackSpeed` hook, asked
  after the weapon's, spell's or special's own speed), magic accuracy x2.75 and +200 permille
  magic damage (the equipment-effect modifiers), a 90% roll a cast that keeps the runes (the
  existing `magic:rune-saving`, asked once the cast has checked the player has them, so they are
  required but not spent) or the staff's charge (`combat:consume-charge`, asked by the trident in
  core and by the Sanguinesti staff and Tumeken's shadow before a charge is spent), in multicombat
  a landed spell also hits up to five attackable targets within a tile of its target for 0 to 25%
  of its damage (fixed-damage hits that pay no XP, never splash themselves and are not scaled
  again by Berserker, since the hit they derive from already was), and the standard
  binds and Ancient ice spells always land unless the target is frozen or still freeze-immune.
- **Berserker** (tier 7): every hit is multiplied by 1 + 0.004 x missing hitpoints (floored), and a
  hit on an NPC at full health is forced accurate at its max.
- **Undying Retribution** (tier 8): when a death would go ahead (`onPlayerBeforeDeath`, after any
  other content kept the player alive) and three minutes have passed since it last fired:
  hitpoints and prayer to their max, poison, venom and the poison immunity cleared, the
  Retribution prayer's graphic 437 (ours), and a reflected hit of 0 to 2 x Prayer level on every
  attackable NPC within three tiles that is not attack-immune and that the area's policy lets
  the player fight (recoil-immune ones only if Nex, the Hespori, Vorkath or a Wilderness boss)
  and 0 to half the Prayer level on each player fighting them. The cooldown is
  a timestamp attribute (0 when ready), reset by a real death (the defeated hook, which every
  death reaches; the death hook stops at the first plugin that handles the death, as the raids
  do, so a death inside one would never have reset it). A plugin that already prevented the
  death on this hook is honoured; one attached after this plugin would see the relic fire first,
  since every before-death hook runs. A prevented death counts for nothing in a raid (Wiki: no
  raid death penalties): core never starts the death task, so the Chambers, Theatre, Tombs and
  Archive death handlers, which take points, count deaths, jail, ghost and check wipes, never run.
- **The Arcane grimoire** (`ArcaneGrimoire.LeagueRelics.js`), the item Superior Sorcerer and Raging
  Echoes' Grimoire relic grant: for a league character its cache options, from the inventory or
  worn, are Change Spellbook (a chat choice of the other three books), Previous Spellbook (back
  to the book the last change left; it toggles) and Check Previous (ours: "Your previous
  spellbook was the Ancient spellbook."). The swap is the altars' (`MagicSpellbook.changeSpellbook`:
  Lunar's 40 Defence, autocast cleared, the tab, "You have changed your magic spellbook."); this
  server's altars gate the books on nothing else, so neither does the grimoire where the
  Trailblazer Reloaded relics page says "providing players have unlocked them". The previous book
  is the attribute `league:grimoire-previous-spellbook`, remembered only when a swap went through.
  Holding the item is the only check (it is untradeable and only a relic grants it; a spawned one
  works for any league character). Not covered: its Book of the Dead role (the resurrection
  spells' requirement, checked in core), and Raging Echoes' Grimoire unlocking every prayer and
  spell.
- **Archer's Embrace** (tier 4): ranged speed halved (`onAttackSpeed`: above 4 rounded down,
  below 3 rounded up, so 3, 4 and 5 all become 2 as the Wiki's notes say), ranged accuracy x2,
  on a landed ranged hit a 10% chance of an extra `PendingHit` at the same target with a roll of
  its own (no ammunition spent and no projectile shown for it, a second hitsplat: ours; the extra
  never fires another, and is an ordinary shot: it is rolled as if no special were armed, its
  accuracy and damage included, and a special armed after the original shot stays armed with its
  energy, `PendingHitConfig.ordinary`), 90% of each volley's
  shots kept (`ranged:ammo-saving`, so an Ava's device recovers its share of the rest, the
  Wiki's 98%), the same 90% for a ranged weapon's charge (`combat:consume-charge` while the
  player's combat method is ranged: the crystal bow, venator bow, blowpipe scales and
  chinchompas), and enchanted bolts' chance x2 (`combat:bolt-proc-chance`). Not done: a bow of
  Faerdhinen's charges, which this server does not model.
- **Brawler's Resolve** (tier 4): melee speed halved the same way, melee accuracy x1.5, every
  defence x1.5 (the melee defence modifier, whose effective level the ranged roll shares too, and
  the magic one), a landed melee hit has a 10% chance to deal double damage
  (`onCombatHitDamage`), 90% of a melee weapon's charges kept (scythe, crystal halberd,
  Arclight), and immunity to poison, venom and dragonfire (`combat:status-apply`). Stuns and
  freezes still take, as the Wiki says roots and stuns do. Not done: "icy breath" and the other
  NPC-specific statuses the Wiki does not name. Superior Sorcerer's charge saving now checks the
  attack is a magic one, since every charge weapon asks the same question.
- **Soul Stealer** (tier 7): the minimum hit rises to 10% of the max hit (the max as combat
  computes it for that hit, floored, applied to every accurate hit), and a landed hit has a 50%
  chance to restore hitpoints and prayer by 10% of its damage rounded up. The restore skips
  special attacks and launches that struck more than one target in the same cycle (a scythe
  whose three hits land on one target counts; an enchanted bolt's effect is part of its hit, so
  it counts; a venator bow's bounces make its first hit a multi-target launch here, where the
  Wiki lets the first hit heal).
- **Weapon Master** (tier 7): special attacks against NPCs are forced accurate
  (`onCombatHitRoll`) and every special's hit is floored at 20% of the max hit, every restore
  cycle gives 30% energy (`combat-special:regenerate`; the cycle stays the usual 30 seconds, 15
  with a lightbearer), and a player short of energy may still use a special (`combat-special:cost`
  "check": `allow`), whose drain then costs 25 hitpoints and no energy ("drain": `cost` 0). Ours:
  the sacrifice needs more than 25 hitpoints, so it cannot kill.
- **Executioner** (tier 8): the Sage's axe is a ranged weapon in core's table
  (`RangedData.SAGES_AXE`, a dart-interface thrown weapon with +0 bonuses; the cache has no
  spotanim of its own for it, so it flies as a rune thrown axe: ours), with the relic page's 5
  tiles of reach (7 on long range; the item page's 6/8 is the later Demonic Pacts version) from a
  weapon profile and never used up (a ranged ammo handler). Its requirement in item-gameplay.json
  is 0 (Wiki: no requirements). A ranged hit on an NPC under 20% of its hitpoints (after the hits
  already queued) deals the rest of them (`onCombatHitDamage`), for the relic's owner only. The
  Kraken's ranged reduction applies afterwards as to any hit. Demonic Pacts' owner reaches a tile
  further, 6 (`onCombatAttackDistance`, the effect's `reach`), as the shared profile stays 5.

### Raging Echoes' combat relics

- **Specialist** (tier 8): every special costs 20% (`combat-special:cost`), rolls accuracy
  x2 while a special is active (the three accuracy modifiers), a special that misses refunds 10%
  (`onPlayerDealtDamage`, one refund a missed `PendingHit`), and any NPC kill restores 15%
  (`onNpcDeath`).
- **Last Stand** (tier 8; the catalog's tier 6 copy is an alias): a lethal hit from any source
  (`onPlayerBeforeDeath`) leaves the player at 1 hitpoint, boosts Attack, Strength, Defence,
  Ranged and Magic to 255 and opens a 16-tick window in which every lethal hit again leaves 1,
  food is refused (`onCanEat`) and any other heal is undone on the next tick (the Wiki forbids
  healing above 1 by any means and names no mechanism: ours). A tick task drains each boost 16 a
  tick down to base + 15; when the window closes the player is
  healed by the damage their hits did as they landed in it (`HitDamage.onApplied`: an impact
  cancelled before it lands counts nothing), capped at their max (ours: the Wiki shows a bar over the
  head and gives no formula; no bar here). Once every three minutes, reset by a real death
  (`league:last-stand-ready-at`). Not done: the Wiki's instant-kill exceptions (they are not
  hits here either), and the skills packet carries a boost as a byte, so the client's boost
  overlay for a 255 may read oddly while the level itself shows.

### Trailblazer Reloaded's gathering relics

- **Endless Harvest** (tier 1): what Mining, Woodcutting and Fishing gather is doubled and banked
  (`storage:gather` with the skill: two go to the bank and the inventory gets nothing; an open
  container such as a coal bag keeps what it took and the rest goes to the bank; when the bank
  has no room the extra goes to the inventory if it fits), the extra pays the resource's XP again
  only when it was placed, and `storage:room` says the bank's room counts so a full inventory
  keeps gathering.
  Forestry bark, Volcanic Mine fragments and sulliusceps never pass through `storage:gather`, so
  the Wiki's exclusions hold by construction.
- **Trickster** (tier 1): pickpockets always land and the pouch limit is tripled
  (`thieving:pickpocket-target`), the loot is doubled and noted (`thieving:loot`; coins come as
  pouches, so a second pouch stands for the double: ours; a clue, and an item that neither
  stacks nor notes, once), the pickpocket repeats itself while neither the player nor the NPC
  has moved (`thieving:done`), Agility rolls and fire lighting succeed (`agility:roll`,
  `firemaking:light-roll`), Hunter catches never fail (`hunter:catch-chance`), box traps give
  double loot and XP (`hunter:rewards`) and look for prey every 2 ticks instead of 5
  (`hunter:lure-interval`: the Wiki says "faster" and no more, so the number is ours), impling
  jars never break (`hunter:jar-kept`), and up to nine logs burn in one action
  (`firemaking:logs-per-action`, one fire, XP for each). Not here: the Sage's greaves (not in
  this cache) and the barbarian firemaking hotfix. "Always succeed" covers what the Agility,
  Hunter, Thieving and Firemaking plugins roll themselves: the Werewolf course, the Brimhaven
  arena, the Hallowed Sepulchre and the Chambers of Xeric tightrope roll on their own and still
  can fail.

### Raging Echoes' gathering relics

The Echo pickaxe, axe and harpoon sit in Mining's, Woodcutting's and Fishing's own tool tables as
crystal tools with no requirement (the Echo pickaxe page: always a 2-tick cycle, quicker than
this server's crystal pickaxe, which rolls every 3 ticks with a 1 in 4 chance of 2), and their
Toggle option cycles the relic's modes (`league:<relic>-mode`, our messages). Each tool's own
effects need the tool carried or wielded (Wiki); a relic's other effects (Lumberjack's sure fires,
Animal Wrangler's Hunter and cooking ones) do not.

- **Power Miner** (tier 1): a failed swing's second 50% chance (`mining:attempt`), ore straight
  to the bank (`storage:gather`), a rock that stands until its fourth ore
  (`mining:deplete-rock`; counted per rock for everyone who mines it: ours; the Wiki's
  mining-glove stacking is not modelled, gloves are not here), and the toggles: ore smelted into
  its bar (`smithing:bar-for-ore`: the furnace recipe whose main ore it is, its other ingredients
  waived, so a copper ore alone makes a bronze bar: ours) with the Smithing XP whatever the
  level, and gems cut (`crafting:cut-gem`) with the Crafting XP. Coal, never a recipe's main
  ore, is banked as it is.
- **Lumberjack** (tier 1): a failed chop's second 50% chance (`woodcutting:attempt`), logs
  straight to the bank, the toggles (logs burnt for their Firemaking XP, the default, through
  `firemaking:log-xp`; or fletched into arrow shafts for the bank with the Fletching XP, through
  `fletching:shafts`, which answers arrow shafts only, so a teak or mahogany log is banked as
  it is), and fires that never fail to light (`firemaking:light-roll`). The Wintertodt kindling
  variant is not here.
- **Animal Wrangler** (tier 1): the harpoon stands in for any fishing tool when none is held
  (`fishing:tool`; bait is still needed), catches come a tick sooner (`fishing:interval`), a
  failed catch's second 50% chance (`fishing:attempt`; it lands the best fish the player can
  catch at the spot: ours), fish straight to the bank (not
  karambwanji, which stay with the player as on live), half of them cooked on the way when the
  harpoon says so (`cooking:cooked`, the Cooking XP whatever the level; never the big shark,
  swordfish or bass), food that never burns (`cooking:burn`), and the box-trap, catch and jar
  effects Trickster has.
- **Corner Cutter** (tier 2): Agility rolls always succeed (`agility:roll`), a lap counts twice
  and its completion bonus pays 25% more (`agility:lap-reward`; the obstacles' own XP is not
  raised: ours), and a mark of grace spawns with 10,000 coins
  (`agility:mark`). Not here: the Sage's greaves, and the doubled pyramid tops, hallowed marks,
  Brimhaven vouchers and crystal shards (their plugins hand them out without a seam).
- **Dodgy Deals** (tier 2): every pickpocket lands (`alwaysSucceeds` on
  `thieving:pickpocket-target`) and the pouch limit is tripled, the loot is noted and multiplied
  by the NPCs of the same name alive within 5 tiles of the player (the Wiki's 11x11; coins a pouch
  each: ours; a clue, and an item that neither stacks nor notes, once, as the Wiki says),
  pickpockets and stall thefts repeat themselves while neither the player nor the NPC has moved
  (`thieving:done`; chests have no repeat here either), and a stall never empties for the owner
  (`thieving:deplete-stall`; another player's theft still empties it for everyone, as on live).

### The production relics

- **Production Prodigy** (Trailblazer Reloaded tier 1): Crafting, Smithing, Herblore, Fletching
  and Cooking boosted by 12 (`skills:level-boost`; invisible, wherever those skills check their
  own level, Superheat Item included, so requirements and success charts both see it: the Wiki
  does not say which; the Blast Furnace's own Smithing check is not boosted), the
  Wiki's activities all at once with full XP (`skills:actions-per-cycle`: smelting, smithing,
  cannonballs; fletching logs (shafts, shields and unstrung bows), stringing, bolt tips (the
  group also cuts kebbit and antler bolts and wolfbone arrowtips: batched too, ours); cleaning herbs
  and mixing potions whose secondary does not stack; cooking; leather, jewellery, battlestaves,
  pottery, gems, glassblowing, spinning), and a 25% chance of the same product again, banked with
  its XP (`skills:produced`; only when the bank has room). "All at once" is up to 28 a cycle, the
  inventory's slots: ours. Molten glass, smelted at a furnace, is Crafting and not on either
  list. Not here: jugs of wine (no wine making in this server); Guardians of the Rift's essence is
  not a Crafting loop here, so the Wiki's exclusion holds.
- **Production Master** (Raging Echoes tier 5): the same list all at once, plus arrow shafts,
  headless arrows, arrows, bolts and gem-tipped bolts, and darts (10 times the usual a cycle,
  Wiki; darts and bolts by default fletch in one click, and that click makes 10 too), and amethyst
  (10 December 2024). No boost and no extra product. Pies and pizzas exist only in The Mess here
  and are not batched.
- **Friendly Forager** (Raging Echoes tier 2): the Forager's pouch, carried or worn, finds a
  grimy herb when the player mines, chops, fishes or hunts (their success events), at most once
  every 9 ticks, one the player could clean at Herblore level + 25 and of a kind the pouch holds
  fewer than 30 of (`herblore:herbs` lists them); a minigame's reward (the Fishing Trawler, the
  rumour sack) is not gathering. The herb's cleaning XP for each find is ours (the Wiki: "a small
  amount"). Check, Fill and Withdraw (as notes) are the cache's options, on the pouch clicked; the
  pouch keeps its own herbs, where live shares them with the herb sack. In Herblore
  (`herblore:mix`), a secondary ingredient (any after the recipe's first, its primary, that is
  not a potion or a vial, so a haemostatic dressing's poultice is always used; and a
  super combat's or anti-venom+'s torstol potion (unf), Wiki, whose vial is kept with it) is
  kept 90% of the time, never crystal dust (Wiki), and a potion brewed from an unfinished one
  comes with 4 doses instead of 3, whatever the recipe calls its product (Compost potion(4) from
  supercompost; an upgrade of a dosed potion keeps its doses). Unfinished
  potions keep their herb. These Herblore perks need only the relic, not the pouch (ours: the
  Raging Echoes page does not tie them to it). Not here: the Menaphite remedy (no recipe in this
  server).

### The economy and farming relics

- **Fire Sale** (Trailblazer Reloaded tier 3): every shop with the standard shop interface that
  takes coins sells for nothing (`shop:buy-price`; the stock still limits what can be bought, so a
  shop with one left sells one a click), what it sells comes noted when the item has a note
  (`shop:delivery`), and it buys nothing for coins (`shop:can-sell`). The Wiki's noting is a
  player's toggle; this shop interface has no button for it, so it is always on: ours. Tokkul and
  the other currencies are untouched (selling to a Tokkul shop works), as are costs outside shops
  (sawmills, servants). The Grand Exchange and the reward shops (Omnishop) are not this interface.
- **Golden God** (Raging Echoes tier 4): High and Low Level Alchemy need no runes and no Magic
  level, give 15% more coins (rounded down), keep the item 65% of the time (a kept item frees no
  slot, so a full inventory without coins refuses the cast rather than lose them), and cast again on what
  is left in the slot once each cast ends, until the stack is gone or moved (walking and attacking
  do not stop it; logging out does), with the usual XP and speed (`magic:alchemy-policy`). A cast
  another plugin has turned into something else (Mage Training Arena's coins, While Guthix Sleeps'
  explosive) keeps only the free runes and the level. 20,000 coins are offered on an altar as one
  dragon bone (`bone-altars:offering`): the Chaos Temple's and a house's altar give their own
  experience and keep the coins as they keep bones; any other altar one prays at gives the bone's
  burying experience (Wiki); the offering repeats while the coins last, at the altars' own pace,
  stopped by a walk or click (the Wiki: until logout). The Ectofuntus and the Libation bowl take no
  coins. What a coin shop sells comes noted (as Fire Sale; always on: ours). Not here: the casting's
  pause during production skilling (the Wiki's), which needs a skilling state this server does not
  keep; the Wiki's other chaos altars that take coins (Ourania, the Asgarnian and Black Knights'
  temples, Underground Pass) are plain altars here.
- **Farmer's Fortune** (Trailblazer Reloaded tier 6): a 20% chance to keep the seed or sapling
  planted (with its pot, and no Amulet of bounty charge; the message is ours), patches grown the moment they are planted and never
  diseased (`farming:plant-rules`; anima plants still grow, their last stage is their end),
  harvesting 25 times faster (25 picks an action, `farming:harvests-per-action`), and each pick
  three times the produce, noted (`farming:pick`; the herb sack takes only unnoted herbs, so these
  go to the inventory). The usual Farming XP a pick, not tripled: ours, the Wiki gives no XP rule.
  Wood trees, which are chopped and not picked, give the usual logs.
- **Overgrown** (Raging Echoes tier 7): the Leprechaun's vault opens the seed vault anywhere
  (`farming:open-seed-vault`); crops never die (a diseased crop waits for a cure instead,
  `farming:plant-rules` `undying`); planting keeps the seed 75% of the time, with live's message
  ("Botanical allows you to keep your ...", Wiki trivia). These need only the relic (Wiki). Both
  rules are kept on what is planted from then on. Not here: the automatic harvest and replanting
  of a grown patch from the vault's seeds (with its ultracompost memory, contract, pet and Hespori
  rules), which needs a Farming replant path of its own.
- **Pocket Kingdom** (Raging Echoes tier 7): the Pocket kingdom's Check (the approval and coffers;
  the wording is ours), Collect (Advisor Ghrim's collection, to the bank) and Manage-kingdom (the
  kingdom's interface) work anywhere, without Throne of Miscellania and with Royal Trouble's
  enhancements (`miscellania:rules`); the workers cost half the coins for the same work, gather
  twice as much (every resource doubled; the easy clue stays as rolled: ours), and approval is held
  at its maximum (127, 100%). Managing it anywhere counts as a visit (`visiting`), so the subjects'
  30 days without a visit run from the last login or use of the item. Not here:
  the hourly cycle and its 37,500 coins an hour once the coffers hold 375,000; the kingdom keeps
  its daily cycle.

### The clue and Slayer relics

- **Treasure Seeker** (Trailblazer Reloaded tier 5, and the catalog's tier 3 preview of it) and
  **Treasure Arbiter** (Raging Echoes tier 5) share their clue perks: each clue scroll an NPC
  drops comes at least 1 time in 15 (the Wiki's "a 1/15 chance to drop one", read per clue:
  ours), and an impling jar's too; clue nests (trees, birdhouses), geodes and bottles (drift nets,
  aerial fishing) come 10 times as often (Fishing has no clue bottles here); every trail has its
  tier's fewest steps (1 to 6) and every casket its tier's most rolls (3 to 7; the data's ranges
  are the Wiki's).
- **Treasure Seeker** also brings another reward casket from an opened one (not the Mimic's), at
  times a tier higher (never above master), to the inventory or else the bank. The Wiki gives
  no numbers ("more common at lower tiers"): ours, 1 in 5 for a beginner casket down to 1 in 20
  for a master one, a quarter of them upgraded. The messages are ours; with neither inventory nor
  bank room the casket is not given, and a message says so.
- **Treasure Arbiter** also lifts the item requirements of emote steps (what to wear; the elite
  and master steps' Uri outfits are part of the step, not lifted), Falo the Bard's songs (any item
  shown is right, but something must still be shown to him: ours, his steps answer only to an item
  used on him) and Charlie the Tramp's errands (he is thanked without it).
- **Bloodthirsty** (Trailblazer Reloaded tier 5): the enchanted gem, slayer ring and slayer
  helmet's check offers a new task from the last master or a cancel at the usual price
  (`slayer:remote-task`; not Mortimer's tasks, a choice with modifiers made in person: ours); the bracelet of slaughter works 35% of the time and uses no charge;
  superiors come 1 time in 25; each gives Slayer points (ours: 5 plus a fifth of its Slayer
  requirement, the Wiki says only "based on" it) and six more rolls on its normal monster's table;
  a quarter spawn bloodthirsty (a message of ours says so): nine rolls, a clue scroll for sure when
  its table has one (the rarest the player can take now, by its chance), three times the unique chance and a roll on the bloodthirsty
  table (Wiki, Bloodthirsty Nechryarch). Not here: the expeditious bracelet (not in this server);
  the variants' stronger stats, names and icon (no NPCs of their own in this cache).
- **Slayer Master** (Raging Echoes tier 5): every Slayer monster counts as on task
  (`slayer:always-on-task`; a monster some task counts, not one only a boss task gives): its Slayer
  XP, its superior (with Bigger and Badder), the slayer helmet's bonus and every "on task" check,
  without counting down the real task. So combat achievements done "without a Slayer task" cannot
  be done on those monsters with the relic (ours: the Wiki does not say); the reward
  shop's unlocks, extensions, cancels and blocks and its rune pouch, herb sack and looting bag cost
  no points (`slayer:reward-cost`; unlocks still take a click: ours); and the 100th kill of each
  Slayer monster (by name) gives bonus Slayer XP, "You gain [X] bonus Slayer XP." (Wiki), from
  1,000 at Slayer level 1 to 15,000 at 99 in a straight line (ours), with the usual multipliers.
  Not here: Brimstone and Larran's keys anywhere (they follow the league's areas; off-task kills
  drop no keys).

### The item and teleport relics

Their teleports share the standard animation (Demonic Pacts' Map of alacrity: the league's
area-teleport cast, `league:teleport-cast`; the Evil eye: its own recorded cast), their item's Wilderness limit, and the league's
areas: a destination in an area the character has not unlocked is refused (`league:area-at`
and `league:areas`, answered by the league's area unlocks; with nobody answering, everywhere is
open). Each item remembers its last destination. The menus' grouping and wording are ours.

- **Fairy's Flight** (Trailblazer Reloaded tier 2, Raging Echoes tier 3): the fairy mushroom's
  Teleport (or, worn, Fairy-Ring, Spirit-tree, Tool-leprechauns) goes to any fairy ring by its
  code, any spirit tree the character could travel to by tree, and any tool leprechaun (named
  after their nearest fairy ring: ours); from any Wilderness level except to a spirit tree (level
  20, Wiki). Not here: the Tree Gnome Village autocompletion (the quest's own).
- **Globetrotter** (Trailblazer Reloaded tier 2): the pendant's Nexus goes to the spellbooks'
  teleports (standard, ancient, lunar, Arceuus, and the house when the character owns one: not
  a Last-destination, which could not enter it), its
  Jewellery to the ornate jewellery box's 27 destinations, up to level 20 Wilderness, 30 for a
  dragonstone piece's destination and its last destination (Wiki, 6 December 2023). No runes.
- **Banker's Note** (Trailblazer Reloaded tier 3, Raging Echoes tier 6): an item used on the note
  is noted, a note unnoted (as many as the inventory and the stack's limit hold); Activate repeats
  the last item;
  Note-Quantity and Un-note-Quantity set how many each use converts (all until set: ours); Toggle
  switches Activate between noting and unnoting (ours: the Wiki does not say). Not here: Guardians
  of the Rift's essence rule.
- **Clue Compass** (Raging Echoes tier 3): the compass goes to any STASH unit, built or not, and
  to Falo the Bard; Current-step to where the clue read last leads (not a step that asks for a
  kill, nor a hot-cold step's spot: ours), from any Wilderness level, onto the nearest open tile
  when the spot is solid; used on Falo it is the item he asks for. The Wiki's three Varlamore
  units left out near the Twilight Temple count here. Not here: beginner clues' Current-step
  (their trails are kept apart).
- **Bank Heist** (Raging Echoes tier 3): the Banker's briefcase goes to any bank, bank chest or
  deposit box in an unlocked area, from any Wilderness level, onto the nearest open tile with
  floor to walk from (the customers' side of a counter). The list is every bank booth, chest,
  counter, table and deposit box with an option in the cache's map (a "Chest" only with a Bank
  option; dump-loc's template copies left out), near ones (12 tiles) merged:
  `plugins/modes/data/league-bank-heist.json`, generated by `scripts/league-bank-heist.mjs` from
  `yarn dump:loc` (the command is in the script; regenerate rather than edit). The cache names no
  banks: each is named after the nearest fairy ring, jewellery or spell destination within 40
  tiles, else after a fairy ring's region within 150 with its tile, else its kind and tile; all
  ours. The menu groups them by the league's area when the area unlocks answer (banks outside
  every area as Other), else in alphabetical runs. Not here: the Wiki's quest gates on some banks
  (Sophanem, Keldagrim and others): the league's areas decide; banks in raid, minigame and
  instanced map areas are listed as the map has them.
- **Evil Eye** (Demonic Pacts tier 3): the Evil eye's Teleport (an area submenu in the cache,
  carried or worn) lists an area's bosses and raids, Last-destination repeats the last; to the
  entrance of each (Barrows' chest or its surface, each Moon of Peril), from any Wilderness level,
  only in unlocked areas (the submenu's area and the tile's own). The Wiki's pins often mark a
  dungeon's surface: `plugins/modes/data/league-evil-eye.json` takes each tile from the server's
  own lair, raid or teleport data (its `source`), checked open on the cache's map. A boss's own
  requirements (kill counts, keys, tasks) are met or refused at its entrance. The cast is the
  eye's own, as 237/04057 records it: evil_eye_cast01 and spotanim leagues_6_evil_eye a tick after
  the pick, the move four ticks later, and varp league_default_teleport_last_destination set to the
  tile (packed z << 28 | x << 14 | y). Live's menus are interface 187's (script 217): "Select a
  region" with locked areas struck through, then "Evil Eye teleports - <area>" with live's own
  labels ("Barrows Chest", "Fight Caves", "TzHaar-Ket-Rak", ...) and Back; only five areas' lists
  are recorded, so the chatbox menus and the Wiki's names stay for now.
- **Map of Alacrity** (Demonic Pacts tier 3): the Map of alacrity's Read (an area submenu) lists
  an area's Agility shortcuts, Last-destination repeats the last; from any Wilderness level, in
  unlocked areas, with the shortcut's Agility level (current) and the Wiki's quest notes (Shadows
  of Custodia, The Final Dawn; `quest:is-complete`). The shortcut keeps its own requirements. The
  Wiki's "less favourable side" is read as the end of the server's shortcut nearest the Wiki's
  pin: `plugins/modes/data/league-map-of-alacrity.json` keeps the 57 shortcuts the server has
  where that end is clear and open, and lists the other 84 rows and why.
- **Total Recall** (Raging Echoes tier 6): the Crystal of Echoes' Save-memory keeps the place,
  Hitpoints (up to 127, as live), Prayer and special attack energy; Teleport-back returns there
  from any Wilderness level and sets the three back; Check-memories says what is kept (ours). Not
  in an instance, nor underwater at Fossil Island. No cooldown; the memory outlasts death.
- **Grimoire** (Raging Echoes tier 7): spells' area, quest and diary requirements are lifted
  (`magic:spell-unlocked`; here the Mage Arena's god spells without their 100 casts); the Prayer
  level still counts, and no prayer here is gated by a quest. The Arcane grimoire's spellbook
  swap is the item's own plugin (above).
- **Reloaded** (Raging Echoes tier 4): one more relic of tiers 1-3, a different one from that
  tier's own pick, chosen with the same click on it (`league:relics-extra`; any item it hands out
  is given). The relic interface shows only each tier's own pick: ours.

### Equilibrium (both leagues)

Trailblazer Reloaded's tier 6 and Raging Echoes' tier 4: every gain of experience
(`skills:experience-gained`, emitted after the gain) adds a bonus in the same skill of 10% of
the total level, 20% when the skill is the one with the least experience, added with the
multipliers off (neither the world's nor the league's rate) and floored to tenths like any
gain; the bonus's own gain brings no bonus. Several skills tied for least experience (a fresh
character) resolve to the first in skill order: ours. Live tracks and shows the relic's XP; here
it is a plain XP drop.

## Tier passives

Each tier's passive text is the Wiki's (`league-relics.json`); the effects are
`leagues.json` `passives`, per league, each from the 1-based tier its `fromTier` names (a map
picks the highest tier reached), applied by `league/Passives.LeagueMode.js` and
`league/BoostedDrops.LeagueMode.js` to a league character of that league and to nobody else.
Tier 1 counts once the character chose its first relic.

- **XP rate** (5x; Raging Echoes 8x from tier 2, 12x from tier 5, 16x from tier 7; Demonic Pacts
  8x, 12x and 16x from tiers 2, 4 and 6, as its tier structs' passive text says): the
  can-gain-experience hook's `multiplier`, as above.
- **Combat XP** (Raging Echoes tier 3 x2; Demonic Pacts tier 3 x1.5): Attack, Strength, Defence,
  Ranged, Magic, Hitpoints and Prayer gains multiplied on top of the league rate (multiplicative, as the Wiki says; Slayer is not
  listed and not included).
- **Run energy** (tier 1): the run energy drain modifier (`api.registerRunEnergyDrainModifier`)
  returns 0 for the character, so running never drains.
- **Boosted drops** (Trailblazer Reloaded 2x/3x/4x/5x from tiers 1/4/6/8; Raging Echoes and
  Demonic Pacts 2x then 5x from tier 4): `league-boosted-drops.json` is each league's Boosted drops
  page (fetched 2026-10-26; Demonic Pacts' and the area Notable drops subpages it transcludes
  2026-11-01), a source per Wiki row group with the NPC names it covers and the item names it
  boosts (group rows expanded by hand; N/A rows left out; rows one page lists carry `leagues`).
  NpcDrops asks `npc-drops:chance { player, npc, npcId, source, rules }` once per roll and the
  league pushes one rule `{ pattern, multiplier }` matching that source's items, which NpcDrops
  applies to every form of roll ([docs/npc-drops.md](../../docs/npc-drops.md)): a weighted roll's
  boosted weight grows and the pool with it, so 1/512 at 5x is 5/516 (the Wiki rounds to 1/102).
  Superior Slayer monsters' unique tables and Treasure Trails caskets' "clue uniques" rows ask the
  same over `drops:chance { player, source: "superior-slayer-monster" | "treasure-trails-casket",
  rules }`, the pages' Global entries (a tier's "clue uniques" and mega-rare rows; an ordinary
  casket's Open and the Mimic's reward share `Rolls.uniqueMultiplier`). Kills whose
  table NpcDrops rolls are covered as they are, Araxxor's and Zalcano's included (their plugins
  roll through NpcDrops with the NPC named); the giant lairs' chests pass `source` (Obor,
  Bryophyta). Sources rolled by their own plugins are in the data but inert until that plugin
  asks `drops:chance` with the source's name: Revenants, the Grotesque Guardians, Corporeal
  Beast's sigils (not on its table here), the raids' unique chests, Barrows, the Gauntlet,
  Wintertodt, Tempoross, Guardians of the Rift, Fishing Trawler, the Grand Hallowed Coffin, Moons
  of Peril, the Colosseum, Hunter rumours, the Shrine, the seed pack, aerial fishing, the
  Fountain of Rune, Larran's and the brimstone chest, the Zombie Pirate's Locker, chewed bones,
  the Volcanic Mine ore pack, Pyramid Plunder, Tai Bwo Wannai, Shades of Mort'ton, and the
  pickpocketed blood shards (vyres) and teleport seeds (elves).
- **Minigame points** (Trailblazer Reloaded 3x/5x/8x from tiers 2/5/7; Raging Echoes and Demonic
  Pacts 4x/8x from tiers 1/4): a minigame asks `minigame:points { player, minigame, points }` as it awards and
  the league multiplies `points` (floored). Wired, from the Raging Echoes League page's "Boosted
  minigame points" section (https://oldschool.runescape.wiki/w/Raging_Echoes_League; the
  Trailblazer Reloaded pages give no list, so both leagues use it): Pest Control
  commendations, Soul Wars zeal, Castle Wars tickets, Guardians of the Rift points, Mage Training
  Arena pizazz points, Volcanic Mine points, Giants' Foundry reputation, Mastering Mixology resin,
  Mahogany Homes points, Tithe Farm points, Brimhaven Agility Arena tickets and vouchers,
  Warriors' Guild tokens, Hallowed marks, marks of grace, stardust. Not on this server: Barbarian
  Assault, Rogues' Den, Trouble Brewing, Tai Bwo Wannai favour, Motherlode nuggets, molch
  pearls, Mining Guild minerals, chompy kills.
- **Slayer** (Trailblazer Reloaded tier 4, Raging Echoes and Demonic Pacts tier 3): the Slayer plugin asks
  `slayer:task-reward { player, master, freeTasks, multiplier }` as a task completes (the league
  sets `freeTasks` 0 and x5 the points; every master's, Mortimer's and Krystilia's included, the
  Wiki naming none) and `slayer:superior-spawn { player, npc, unlocked, chance }` on a task kill
  (the league unlocks Bigger and Badder and makes the chance 1 in 50; the Slayer rewards'
  toggle-off still holds; a better chance from elsewhere stands).
- **Scroll boxes** (tier 1): ClueCapacity asks `treasure-trails:scroll-boxes { player, unlocked,
  capacity }` and the league answers unlocked with no limit, so every clue drops as a stackable
  box (the Wiki says stackable; live Leagues had no cap) before X Marks the Spot.

Demonic Pacts' passives are Raging Echoes' but for the combat XP, from the tier structs' text in
this cache (struct 6436's tier enum, param 1020). Its boosted drops rest on the drop tables this
server has: the Wiki's "every Desert Treasure II boss drops every Soulreaper axe piece" is a boost
on the pieces each boss already drops here, not a new drop.

Left out, with why: Raging Echoes' and Demonic Pacts' clue-step progress saved between clues (the trail runtime has
no per-step save to carry across scrolls); their one-minute farming ticks (Farming's
growth model has no tick-length seam, and Farming is under active work elsewhere); the
crystal of memories (not in this cache). The ironman restriction is under "The league character"
above: every league character is a standard Ironman.

## Combat masteries (Raging Echoes)

`LeagueCombatMasteries.plugin.js`, data `plugins/modes/data/league-combat-masteries.json`
(https://oldschool.runescape.wiki/w/Raging_Echoes_League/Combat_Masteries): three styles of six
tiers, each needing the previous tier of its style (`requires` in the data), paid with Combat
Mastery points; the first time any style reaches a tier, a passive for every style comes with it.
Only a Raging Echoes character (league type 5) has any of it; a Trailblazer Reloaded or main
character sees nothing and earns nothing. Tiers live in `league:masteries` ({ melee, ranged,
magic }), points in `league:mastery-points` (challenge key -> 1) and the counted challenges'
progress in `league:mastery-progress`.

- **Points.** The Wiki's ten challenges, a point each in any order: a giant (the Giant page's
  race, `giants` in the data), ten monsters of combat level 100+, Scurrius with no other
  damager, a monster with a Slayer requirement of 55+, TzTok-Jad, combat level 100 (checked on
  every level-up and at login), one, two and three distinct Echo bosses, and TzKal-Zuk. Kills are
  judged on `onNpcDeath` by the NPC's name, combat level or Slayer level. As captured
  (227/00075) a point flips its `league_combat_mastery_point_unlock_N` varbit (11585-11594),
  raises `points_earned` (11584) and `points_to_spend` (11583) and shows the green game message.
  **No Echo boss exists in this cache**, so those three points come only from `::mastery point`;
  the data marks them `_missing`.
- **The interface, as captured.** The league side panel's mastery button (656:32) opens
  `league_combat_mastery` (311) as the main modal with `if_setevents` on its clickzones (311:36,
  0-18), menu frame (311:78, 10-18) and style tabs (311:73, 0-26), then runs 3186 on the panel's
  highlight (656:31). A tab click sets `league_combat_mastery_tab` (11596, the slot / 9); a
  clickzone click sets `league_combat_mastery_last_viewed` (11595) to its slot (Melee 0-5, Ranged
  6-11, Magic 12-17; 18 is nothing) and runs 7674 with 17 components, the node's struct (the
  cache's: Melee 1165-1170, Ranged 1171-1176, Magic 1159-1164) and its tier's passive struct
  (1153, 1154, 1156, 1155, 1157, 1158, the order the captured views used). Confirm (311:71)
  unlocks the viewed node: the style's progress varbit (11580-11582), `points_to_spend`,
  animation 8524, `league_5_mastery_unlock_spot` (3045) at height 92, the modal closed, sounds
  4215/4211/4213/4212 at 8/44/80/104. Close (311:76) closes it. Clicks count only after the button
  opened it. Login also sends `league_combat_mastery_tutorial` (17553) = 5 as both recordings
  did. The cache carries this league's masteries, so nothing is sent as struct overrides; script
  2524 before the open is not sent, as for the relic interface.
- **The checks.** A Raging Echoes character, a real tier, not yet unlocked, the previous tier of
  the style, a point to spend. Refusals are game messages of ours. Unlocks are permanent.
- **The masteries** (the Wiki's numbers in the data; `leaguemasteries/Melee|Ranged|Magic|AttackRate.LeagueCombatMasteries.js`):
  - The roll effects (Melee I, an echo's roll, Ranged I, Magic I and IV) act on the core's new
    `combat:hit-rolled`: the undefended roll and the range it came from, before protection
    prayers, shields and incoming-damage modifiers reduce it, which then apply to the result.
  - Melee I: a quarter of landed hits roll again and keep the higher. Melee II: a tenth of melee
    attacks on an NPC queue an echo a tick later, an ordinary melee hit of its own accuracy
    rolled from half the max hit (a special armed since the swing neither shapes it nor is spent
    on it, and stays armed), queued as any hit (its guards and XP), with the captured echo
    projectile (3186/3187, alternating). Melee IV:
    a twentieth of landed hits heal 40% of their damage. Melee VI: echoes on a fifth, and an
    echo may echo in turn, up to eight in a row.
  - Ranged I: a landed roll below 30% of the max hit (with Ranged II's bonus on it) becomes 30%.
    Ranged II: each attack after the first raises the max hit another 5%, back to nothing after
    +20% (counted on the attack's first accuracy roll of a cycle, which comes before the max hit
    is asked for a normal attack and for a special alike). Ranged IV:
    every fifth landed hit heals 5 a hitsplat. Ranged VI: a ranged roll against an NPC is forced
    accurate (an immune target still takes nothing).
  - Magic I: a landed roll above 90% of its max hit (the target's own: a barrage's secondary
    targets have theirs) deals 50% more. Magic II: +5% max hit for
    every idle tick between two magic attacks, up to +40% (our reading: the gap less the attack's
    own tick, noted on the cast's first accuracy roll; the first cast since login takes the cap;
    the Wiki does not say). Magic IV: a roll above 90% heals 10% of the damage when it
    lands. Magic VI: +1% max hit for every 100 hitpoints the target has, up to +10%, added to
    Magic II's, and a target with fewer hitpoints than the max hit (before Magic I, Wiki) takes
    the max hit. The max-hit changes ride the core's `combat:magic-max-hit` request.
  - Tiers III and V: the style's attack rate x0.8 rounded down, or x0.5 rounded down from five
    ticks and up below (`onAttackSpeed`, after the weapon's or spell's own speed, never under a tick).
- **The passives** (`Passives.LeagueCombatMasteries.js`), live once any style reached the tier:
  1 a 95% roll keeps the runes (`magic:rune-saving`), the staff's charge (`combat:consume-charge`)
  and the ammunition (the ranged ammo handler claims the decrement, so nothing is used or
  dropped); 2 every heal +20% (the core's new `stats:heal`, emitted by `Player.setHitpoints`
  whenever hitpoints rise: a raised heal reaches full hitpoints at most, an overheal keeps its own
  target); 3 the three attack rolls x2 (the accuracy modifiers); 4 damage taken x0.85 (the
  incoming-damage modifier); 5 Prayer restores x1.25 (the core's new `skills:restore`, emitted by
  `SkillManager.increaseCurrentLevel`, whose cap stays the caller's: prayer and restore potions,
  the Prayer plugin's bone restores, Doom's holy water and the Theatre's entry go
  through it; enchanted bolts, a few specials and the Falador shield set the level directly and
  are not raised); 6 60% Prayer penetration:
  the roll bypasses the target's protection prayer and the damage then takes 40% of the usual
  reduction (0.6 + 0.4 x the core's constant).

### Shops that never deplete (Leagues VI)

`league/ShopStock.LeagueMode.js`, data `leagues.json` `shopStock`: "Most shop stock will not
deplete" (Leagues VI's news posts, the Wiki's guides). A league character's purchase leaves the
shop's own stock as it was (`shop:keep-stock`); only stock players sold it still goes, down to
the shop's own amount (ours). Every league buy in the recordings (39 shops, 600+ buys) left the
stock unchanged; the exceptions "most" implies are not recorded, so there are none.

## Demonic Pacts

`LeaguePacts.plugin.js` (units in `leaguepacts/`), data `plugins/modes/data/league-pacts.json`:
Demonic Pacts' pact tree (Wiki Demonic_Pacts_League/Demonic_Pacts). Only a Demonic Pacts
character has it; other plugins ask `league:pacts` { player } (pacts, earned, spendable, resets)
and `league:pact-effect` { player, effect } (an effect varbit's gameval name -> value).

- **The tree is the cache's**: DB table `talent_tree` (216), 132 rows in row order, each a node
  whose index is its bit in `combat_mastery_perm_0..5` (bit index % 32), with `linked_nodes` and
  `effect` [effect id, value]. The table names no varbit, and the ids are not the varbits' order,
  so the data's `effects` maps each of the 73 effect ids to the `talent_*` varbit its text
  describes; the recordings confirm 18 of them (237/01098, 01158). A node's value adds to its
  effect's varbit (`talent_prayer_pen_all` 25 -> 50 -> 75). Each node costs one point. The node
  values are the numbers the texts show, and the Wiki's agree with every one.
- **The screen**, as recorded (237/01098, 01102, 01149): View Demonic Pacts (656:32) closes the main
  modal, runs `league_border_pulse_stop` (3186) on the mastery highlight, mounts `talent_tree` (647)
  in the floater, sends its events (frame 647:5 slot 11 OP1, data_layer 647:11 IF_SCRIPT_TRIGGER,
  perm_floating_panel_content 647:20 OP1 + IF_SCRIPT_TRIGGER), then `talent_tree_init` (7892) [1]
  and script 9397. A second click while it is open: "The Demonic Pacts interface is already open."
  The frame's slot 11 closes it.
- **A buy** is Apply Changes, the data layer's script trigger: one int array of the selected
  nodes, its length as a plain varint and each node zigzag-encoded like any int (237/01098:
  `[1, 126]` set bit 63; 238: `[2, 88, 94]` bought nodes 44 and 47). The web client wrote the
  nodes unsigned until it matched (node 63 arrived as 63, which the server refused). Each is checked in the order selected (a later one may link to an
  earlier one), and each sends its own varps and effect; the unlock below plays once. The first pact must be the central one
  (node 0); later ones must link to one held, with a point left and fewer than 40 spent. Then, in
  the recorded order: `talent_points_spent`, the unlock bit, the effect varbit, human_relic_unlock
  with `leagues_6_mastery_unlock` at height 92, `pvp_icons_comlevelrange` (5224) with the combat
  level, the tree closed, sounds 4215/4211/4213/4212 at 8/44/80/104, and the tree again five ticks
  later. `league:pact-unlocked` { player, node, effect } follows.
- **A reset** is the panel's script trigger (237/01158): the messagebox "Are you sure you want to
  reset your pacts, this opportunity might not arise again.", then "Reset Pacts?" Yes / No; Yes
  uses a reset and clears the bits, the points spent and every effect varbit: "Demonic Pacts have
  been reset, you have N points to spend." Without a reset or a pact our own line says why.
- **Points and resets** (Wiki; 237/01098, 01158, 04052, 238/01219): a new character has no point
  and the two free resets, both flagged (`talent_free_reset_1`, `_2`). Every pact task (the
  catalog's `pactTask`, 79) adds a point on `league:task-completed`, after the task's own line: the
  earned varp, then "Congratulations, you've earned a Demonic Pact! You now have N Demonic Pacts to
  spend." in 229628 ("1 Demonic Pact" for the first point earned, as 237/01098 shows; plural
  otherwise, even at 1). The tutorial's two points are two of these tasks, Open the Leagues Menu and
  Complete the Leagues Tutorial, as recorded. A reset task (data `resetTasks`) adds a reset after
  its point: `talent_resets_available`, then "Congratulations, you've earned a Full Pact reset! You
  now have N Full Pact resets" (237/01158, Defeat 3 unique Echo Bosses). The Hueycoatl's first kill
  is one since 23 April 2026 (Wiki; it also sets `talent_huey_pact_reset`), and three come from
  echo bosses (Wiki; ours: the 1, 2 and 3 unique-echo-boss tasks, 3 being the recorded one). Each
  pays once. Saved in `league:pacts` (node indices), `league:pact-points`, `league:pact-resets` and
  `league:pact-rewards`; every login resends the tree in the recorded order (237/01170, 238/01223):
  earned, the free-reset and Hueycoatl flags, the resets, spent, the unlock varps, the effects.
- **The tutorial's pacts page** runs the recorded walkthrough in the tree (647:14): three steps, the
  last waiting for the central pact; the tree comes back with two more, then the next page.
- **The effects** (`leaguepacts/General|Melee|Ranged|Magic.LeaguePacts.js`; each unit's head
  lists its effects, hooks and readings): every one of the 73 reads its value from
  `Common.effect(player, varbit)`, so what a pact gives is the node values the client also shows.
  Shared within the plugin: Regenerate (General: `magic:spell-cost`/`magic:rune-saving`/
  `magic:cast-committed` for runes, `ranged:ammo-saving` per shot, `combat:consume-charge`) emits
  `league:pact-regenerated` { player, kind rune | ammo | charge, itemId, amount, combat, target?,
  special? }, which the element pacts (Magic), the staff-charge rune pacts (Magic) and the regen
  echo (Ranged) hear; every pact heal goes through `league:pact-heal` { player, amount } (General,
  overhealing up to `talent_overhealing_via_talents`); a Ranged echo is Ranged's, also fired by
  the two-handed melee pact over `league:pact-ranged-echo` { player, target, source }. Each small
  damage node's "+10% accuracy in all combat styles" is applied by its own style's unit (7 Magic,
  14 Melee, 15 Ranged); General has the +% accuracy pact. PvP (Wiki): stat boosts, attack speed
  and melee range apply against players; Thorns, Echoes, Blindbag, reflect and the hit-forcing
  pacts do not.
- **Readings of ours** (the units' heads list every one): off-hands are shield-slot items that are
  not shields, and shields go by name (the cache's category 18 agrees but for the crystal shield,
  and plugins cannot read it); min-hit pacts act only on hits past accuracy (a miss stays 0, as
  237/01098 shows; a landed hit is at least the minimum even above the max hit, as it shows too: 3
  at Strength 1); the fire burn bounce
  uses Burning claws' burn; a Regenerate proc saves the whole cast's runes; the crossbow pact's
  echo chance is a roll of its own; which three unique-echo-boss tasks give a reset; PvP beyond
  what the Wiki names (it says stat boosts, attack speed and melee range apply and Thorns, Echoes
  and Blindbag never do).
- **The core hooks** the pacts need, generic: `registerMeleeStrengthBonusModifier` (the prayer-bonus
  and Strength-level pacts add melee strength bonus as the max hit is worked out, so specials and
  the hit modifiers after it scale it) and `registerRestingLevelModifier` (the Defence pact's
  permanent, visible boost: decay and restoration settle at base + boost, as 237/01170 and
  238/01219 show Defence 114 with 99 and 15). Both are in the generic hooks table under Events.
- **Not here:** echo bosses (their reset tasks have no trigger yet), live's second free reset given
  later to characters that already played ("Yama has taken kindly...", 238/01219) and its one-off
  points for tasks done before 23 April (`talent_extra_retro_*`, 237/01167): a character here
  earns those from the tasks. Regenerate does not reach the abyssal tentacle (Wiki, 6 May 2026),
  the Gauntlet's crystal and corrupted bow and staff (Wiki, 23 April), Dizana's quiver, salamander
  tar, the charged bows without modelled charges, or the rune pouch (no event adds a rune to it):
  none of them spends charges through `combat:consume-charge` here.

## Areas

`LeagueAreaUnlocks.plugin.js` (units in `leagueareas/`), data `plugins/modes/data/league-areas.json`.
A league character starts in Misthalin and Karamja (the Wiki's start; live unlocks Karamja free
during its tutorial, which this server has none of) and picks up to three more areas as its
completed tasks reach the league's thresholds: Trailblazer Reloaded 60, 140 and 300 tasks from
Asgarnia, the Fremennik Province, Kandarin, the Kharidian Desert, Morytania, Tirannwn, the
Wilderness and Kourend; Raging Echoes 90, 200 and 400, Varlamore among them (Wiki). Only the next
slot can be filled, a pick is permanent, and the unlocks live in `league:areas` (area ids in
unlock order). An area the league does not offer (Varlamore on a Trailblazer Reloaded world) stays
locked for good.

**Demonic Pacts** (Wiki Demonic_Pacts_League/Areas, recordings 237/01098, 01102, 01104, 01107,
01149) starts in Varlamore alone; Misthalin is never open, while Zanaris and the Abyssal Area are
open from everywhere (overrides with `area: null`). Its first unlock, at 80 tasks, must be Karamja
(`firstPick`; any other area shows the details' message state with our line, the refusal live
gave was not captured), then three picks at 200, 300 and 450: the cache's own thresholds (structs
5971-5975). The unlock plays Raging Echoes' spotanims, as recorded, and the area teleport its own
cast (`leagues_6_home_teleport_player_01..08` every three ticks from +1, landing at +23). An
area's quests complete on its unlock's +14 tick (237/01098's Karamja), the starting Varlamore's at
the league's start: the data's `quests`, each area's Wiki list (Demonic_Pacts_League/Areas/<area>)
with the quests they need nested under them, completed in reverse through LeagueMode's
`league:complete-quests` { player, quests } as a Shattered Relics pack is (no XP, rewards kept;
Recipe for Disaster's subquests left out). With them go the area's Achievement Diary tasks
(`diaryTasks`, the Wiki's lists matched to the diaries plugin's task keys by their text; the
Desert elite Kalphite Queen head and the Wilderness easy earth warrior have no task there) over
`diary:task`, before the unlock's own line as recorded, and its Combat Achievements
(`combatAchievements`, by name) over `combat-achievements:complete`.

**Demonic Pacts' League Home Teleport** (`leagueareas/HomeTeleport.LeagueAreaUnlocks.js`, data
`homeTeleport`; spellbook 218:5; 237/01098, 01107, 01149, 238/01248): Cast asks "Select an
option" with "Yama's lair." and "Civitas illa Fortis.", its other ops go straight there.
Civitas plays the area teleport's cast, whose steps also put `leagues_6_home_teleport_spotanim_0N`
on the caster's tile as a map graphic (the shared HomeTeleportSequence's new `mapGraphic`);
Yama's Lair sets `busy`, opens the portal (3274) on the tile, plays the fall two ticks on and
lands at +4 by the lair's exit, face down under the portal's second graphic. No cooldown was
recorded; the usual teleport rules apply.

**Automatic quests** (leagues.json `startQuests`; Wiki Demonic_Pacts_League, Auto-completed quests):
Account completes Dragon Slayer I, Druidic Ritual, Rune Mysteries and the other 13 at every login
through `league:complete-quests` (`items: false`), so a character made before the list gets them
too; none gives experience (Unlocks' hook) or items: live's new character has only its starting
levels and the starter kit (237/01098), no Air talisman, Elemental shield or Wolfbane. An area's
quests (`league:complete-quests` from the area unlocks) and Shattered Relics' packs keep their
item rewards.

**The starter kit** (leagues.json `starterKit`, obj gameval names): a new Demonic Pacts character
starts with what live's holds at its first login (237/01098, in slot order): the Lumbridge kit
(bronze axe, pickaxe, dagger and sword, tinderbox, small fishing net, shrimps, wooden shield,
shortbow and 25 bronze arrows, 25 air, 15 mind, 6 water, 4 earth and 2 body runes, a bucket, a pot,
bread) and a Dramen staff, nothing worn. Account gives it once, as the character joins: this world
runs no Tutorial Island (world.json turns its plugin off), whose leaving is the only other kit. The
Wiki has the Leagues Tutor hand out the Dramen staff (with a spade, an impling jar and two strange
devices); with no Leagues Tutor here, the staff comes with the kit, as the recording shows it held.
The other leagues have no recorded kit, so none.

**Yama's Lair** (Demonic Pacts' start, `start` 1503, 5602; 237/01098): its 24 NPCs are world
spawns from that recording (`npc-spawns.json`, source `rsprox:237/01098`); the Glowing portal's
Leave (`YamaExit.LeagueAreaUnlocks.js`, `exit`) goes to Civitas through the shadow fade.
**Yama's stepping stones** (`YamaStones.LeagueAreaUnlocks.js`, data `stones`; 673 jumps in
237/01098, the Wiki's Yama's_Lair): no start, end or laps, a count of stones
(`league:yama-stones`, announced every tenth). A jump reaches a stone 2-3 tiles off (4 from the
shore tiles the recording used), else "I can't reach that!", and resolves on the click's own tick:
the player is on the stone with `human_yama_shortjump01`'s slide from the stone left (PlayerSession
writes an exact-move's end from the current tile, as the protocol does), and the next tick's
start clears the slide before that tick's click, so a stone a tick. The stone left burns for six
ticks (`league_6_yama_agil_fire_npc`, six at most): landing on it hits 1 with "The stone burns your
feet…" and no experience, yet counts. Otherwise 3.6 Agility experience, which the recording's
level-ups give at the starting 5x (about 18; the Wiki says 8). Each stone is the course's lap
(`agility:lap`, course `yama-stepping-stones`), for "Jump on Yama's stepping stones 666 times".

**This cache's buttons** (rev 241, as the Leagues VI recordings use them): the details' teleport
is `select_button` 512:84 and the unlock `confirm_button` 512:62 (rev 227's echo_boss_map_button
82 and confirm_frame 60 have no op on this client), and script 3668's components are rev 237's
(the data's `_rev241`). The screen opens as the other league modals do (Panels, below).

- **The areas** are the cache's: DB table `region_data` (82) gives each area its id (1 Misthalin,
  2 Karamja, 3 Asgarnia, 4 Kandarin, 5 Morytania, 6 Kharidian Desert, 7 Tirannwn, 8 Fremennik,
  11 Wilderness, 20 Kourend and Kebos, 21 Varlamore), name, the interface's shield and name
  components and its teleport hub (`area_teleport_coord`). The unlock spotanims are the cache's
  `league_<type>_area_unlock_emote_spotanim_<area>`.
- **The map** is ours, since the cache has no map-square to area table: each area lists 64 x 64
  map squares (`rects` and `squares`, map coordinates = tile >> 6) drawn from the Wiki's
  descriptions, over the cache's own map list (`CacheMaps.getRegionIds`). The lowest-numbered area
  naming a square owns it, a league's `overrides` reassign squares (the Stranglewood: Kourend in
  Trailblazer Reloaded, Varlamore in Raging Echoes), an unnamed underground square (map y >= 100)
  follows its surface square (the Wiki's "underground areas with an entrance in X"; Taverley
  Dungeon is Asgarnia's, the Underground Pass Tirannwn's by explicit squares), and a square nobody
  names is open to everyone: instances, Death's Office, the POH, random events, the essence mine,
  Tutorial Island (the Wiki's accommodations). Known approximations of the grid: the four tiles
  between Lumbridge and the Al Kharid gate and Catherby's beach east of x 2816 fall with Al Kharid
  / Asgarnia, the River Salve's east bank at Paterdomus with Misthalin, Tutorial Island's eastern
  tip with the desert. `league:area-at { x, y }` answers for any tile.
- **Enforcement** (a main character is never asked): a map-square change into a locked square
  (`onPlayerMapSquareChange`, once per square crossed, by a step or by a teleport, ladder, boat or
  dialogue) goes back to where it started when that is open (the Wiki's magical barriers, at
  square granularity), else to the league home; a respawn goes to the league home. The correction's
  own move is not treated as a new crossing. A teleport whose destination is known
  (`onCanTeleport`) is refused with a message. `player:respawn` sends a respawn another plugin
  landed in a locked square, or the world's spawn when that is locked, to the league home; the
  `onPlayerDeath` hook flags the player for that tick so a later respawn handler's landing is
  caught by the map-square rule too. The league home is the world's spawn, or Misthalin's hub
  (Lumbridge) when the spawn is locked (this world's spawn sits on the Wilderness ditch), so it is
  always open; a character that logs in inside a locked square (a new one at that spawn, an old
  one whose square the data no longer gives it) starts there.
- **The interface**, as captured (227/00070, 00075, 00095, 00196, 01710): the side panel's View
  Areas (656:40) opens `trailblazer_areas` (512) as the main modal with `if_setevents` on its menu
  frame (512:7, slots 10-18). A shield, a name or the name header (512:44) sets
  `league_area_last_viewed` (11693) and runs script 3668 with the area, the state and (rev 241) a
  string: 1 unlocked ("Teleport to"), 2 affordable ("Unlock"), 0 more tasks needed, 4 no slot left,
  3 a server message (an area outside the league); the texts of 0 and 4 and the refusal messages
  are the client's own (script 3676). Confirm (512:60) unlocks: `trailblazer_league_area_unlock_emote`
  8792 with the league's spotanim for the area, the modal closed, sounds 2353/2344/2330/2331 at
  24/116/241/273, and `league:area-unlocked` at once (the save is immediate); fourteen ticks later
  (the emote's length) the slot's `league_area_selection_N` (10662-10667) = the area id, the chat
  message "Congratulations, you've unlocked a new area: <col=league colour>Name</col>.", the
  interface opened again and the popup "Area Unlocked!" with jingle 281 (a logout in between
  loses only this half; the login resends the varbits). A task award that reaches the next slot's tasks shows
  "New Area Available!" with jingle 283 once and sets `league_area_available` (11695; recomputed
  at login and after an unlock, which the one capture of it did not show). The slots' task counts
  go to the client as `structOverrides` of structs 5971-5975 (param 1010, read by script 3682),
  through LeagueMode's content packet. Shield, teleport and confirm clicks count only after View
  Areas opened the interface.
- **The teleport** (512:82 on an unlocked area): the modal closes and a home-teleport cast lands
  the player within two tiles of the area's hub, as captured (Lumbridge, Brimhaven, Rellekka,
  Canifis, Al Kharid; the other hubs are the table's). No cooldown (some ninety casts in one
  recording); interrupted like a home teleport; refused in combat (ours) and by the usual teleport
  rules. Raging Echoes plays its captured cast (`home_teleport_human_echoes_1..5` with
  `vfx_league_5_home_teleport_01..05` at +1, +4, +9, +14, +18 ticks, landing at +21,
  `HomeTeleportSequence`'s `cast` option); Trailblazer Reloaded's own was not captured, so it plays
  the standard home teleport cast.
- **Not covered**: the world map's greying of locked areas (client-side), the league tutorial's
  guided first unlock, and slayer or transport content that should read `league:areas` itself.

## Tasks

`LeagueTasks.plugin.js` with its units in `plugins/modes/leaguetasks/`: the catalog of each league's
tasks, the triggers that award them and the cache's task list interface. A completed task is a key
of LeaguePoints' `league:tasks` (id -> points); the task's points are its tier's.

- **The catalog** is `data/league-tasks.json`, **generated** by `scripts/generate-league-tasks.ts`
  (`yarn generate:league-tasks [--from <dir>] [--save <dir>] [--check]`) from the Wiki's
  Trailblazer_Reloaded_League/Tasks, Raging_Echoes_League/Tasks and Demonic_Pacts_League/Tasks
  pages (one `{{TRLTaskRow}}` / `{{RELTaskRow}}` / `{{DPLTaskRow}}` template per task in the raw wikitext: name, description, requirements, tier,
  region, the Wiki's id) and the rev 241 cache; never edit it by hand, change the generator and
  re-run it (same inputs, identical file; `--check` fails when the committed file is stale). A
  task has a stable string id (its name's slug; saves hold ids, so the list order is free to
  change), `wikiId`, tier 1-5, points (Easy 10, Medium 40 Trailblazer Reloaded / 30 Raging
  Echoes, Hard 80, Elite 200, Master 400: the Wiki rows show the first two, the pages' per-area
  totals reproduce the rest, and Raging Echoes' match cache enum 2671), the client's area id
  (enum 3412: Global 0, Misthalin 1 ... Kourend 10, Wilderness 11, Varlamore 21), a category (enum
  3411: 1 Skill, 2 Combat, 3 Quest, 4 Achievement, 5 Minigame, 6 Other) and, where derivable, a
  `trigger`. The Wiki has no category: a task the cache's own list has by name (enum 5950's rows
  of DB table 118 `action`, column 35: most of Raging Echoes and the Trailblazer Reloaded tasks
  that share a name) takes the cache's, the rest a rule in the generator (`categorySource:
  "rule"`, ours). The Wiki's Trailblazer Reloaded id 1522 is on two tasks (The Frozen Door,
  Defeat Vardorvis); kept as the Wiki has it.
- **Demonic Pacts' catalog is the cache's own list** (`fromCache: true`): this cache (rev 241) is
  the Demonic Pacts cache, so its task enum 5950 and table 118 rows are that league's. The
  generator reads them in position order: name, description, tier, area and category as the client
  shows them, tier points from enum 2671 (10, 30, 80, 200, 400), and the position as the task's
  `position`, its completion bit. Only rows marked in the league (column 34) are tasks: 1592 of the
  1593 ("Equip a Dragon Crossbow", position 1431, is not), so a task past it keeps its position,
  not its index. A missing column reads table 118's default, -1 (one task has no category). The
  Wiki's Demonic_Pacts_League/Tasks page (`{{DPLTaskRow}}`) joins by its `id`, which is the cache
  position for every row, for the requirements, `pactTask` (79 tasks that award a pact point) and
  the description a trigger is derived from (it keeps "(not including Agility and Hitpoints)",
  which the cache's shorter text drops); the cache's name wins where the Wiki's differs ("Fully
  clear a dense jungle", the Wiki's "Chop a dense jungle"). The client needs no overrides for it,
  so `league:content-rows` adds none.
- **The list** (`league_tasks`, 657; `data/league-task-list.json` holds every id below). As the
  cache's scripts read it (3202 -> 3204 -> 9428): the rows come from enum 5950 (position -> a row
  of DB table 118: 0 name, 1 description, 32 tier, 34 "in this league", 35 category, 36 area),
  a tier's points from enum 2671, and a task's **completion** from bit `position % 32` of varps
  2616-2631 (positions 0-511), 2808-2835 (512-1407), 3339-3342 (1408-1535) and 4036-4049
  (1536-1983) (script 9470). The cache only carries the current league's rows, so a league's own
  catalog goes in the content payload (see above) as `enumOverrides` (5950 and 2671) and
  `dbRowOverrides` (rows 300000 + league type x 10000 + position), at login and again before the
  list opens (`Catalog.LeagueTasks.js` answers `league:content-rows`; `GamemodeContentStore` and the
  cs2 `db_getfield` / `db_getfieldcount` / `db_getrowtable` ops read the rows before the cache, the
  only table reads the list's scripts make). The
  recordings never carry the completion varps, the scripts read them, so they are sent at login
  and whenever the points change (`Complete.LeagueTasks.js`, only the varps that changed). The
  task's position in its league's list is its bit.
- **The flow, as captured** (227/00070, 00067, 00068, 01710): View Tasks (656:36) opens 657 in
  the toplevel floater as an overlay (the main modal closed first) with `if_setevents` OP1 on the
  five dropdowns' option lists (7, 8, 15, 7 and 4 slots from 1: the tier, type, area, skill and
  completed enums 2676, 3413, 3414, 4105, 2677), the task rows (0 to the task count) and the menu
  frame 657:6 (10-18). A dropdown option slot N sets its filter varbit to N - 1: the tier
  (`league_task_filter_tier` 10033: slot 3 -> 2, 5 -> 4, 1 -> 0) and type (11689: slot 2 -> 1)
  picks are captured, the area (11692), skill (13340) and completed (10034) ones follow. The
  recordings are revision 227, where the lists were 657:35-39 and the rows 657:17; in this cache
  (241) the lists are the components the filter rows' scripts (3207) build each one in,
  `dropdown_tier` 657:37, `_type` 38, `_area` 39, `_skill` 40 and `_completed` 42, and the rows'
  Expand ops sit on `tasks_background` 657:18, so those take the events (the cache wins on ids;
  the recordings' components would never reach the server from this client). The client's
  scripts filter the rows from the varbits (3699; the area filter's "Unlocked" reads the area
  varbits, the areas plugin's), plus a client-side search. The filters are kept in
  `league:task-filters` and re-sent at login, as the recordings show (10034 = 1, 11692 = 13). A
  row click is the client's expand/collapse and gets no reply; the close button (657:3) closes
  the floater. Clicks count only after View Tasks opened the list.
- **The Leagues VI flow** (rev 237/238 recordings 1098, 1102, 1104, 1105; this cache's list):
  the events go out in the order tier, completed, mastery, type, area, skill, rows, menu frame.
  The mastery dropdown (657:41, enum 5944, `league_task_filter_mastery_point` 20357) is the
  pact-task filter. The rows' events end at the list enum's last key (Demonic Pacts 0-1592, the
  cache's list; Raging Echoes' recordings 0-1589, its task count, which a league we send keeps),
  then `league_task_override_task_wipe` (9404). The search bar (657:45) sets
  `league_tasks_is_searching` 17310 and `league_tasks_search_listen_for_keyboard` 17311 to 1 and
  runs `chatdefault_stopinput` (2157); the typing is the client's. A close during a search resets
  both, closes the floater and runs `chatdefault_restoreinput` (2158); every close then runs script
  9431.
- **Completing** a task (`Complete.LeagueTasks.js`, `league:complete-task { player, id }`): a league
  character, a task of its league, not yet done; the completion bit goes out first (the points
  varp's redraw then shows the tick), `league:award-task` pays the points and shows the popup,
  then the captured game message in the league's colour with the tier's name.
- **Triggers** (`Triggers.LeagueTasks.js`) are data: a task's `trigger` from the generator, or from
  the hand-maintained overlay `data/league-task-triggers.json` (by league type and task id; it
  wins). Kinds: `kill { npcs, count }`, kills of any of the NPCs (by name) added up per task in
  `league:task-kills` (task id -> kills); `level { skill, level }`, `any-level { level,
  excluding }`, `total-level`, `base-level` (Sailing left out, it came after both leagues) and
  `combat-level { level }` on `onPlayerLevelUp` and at login; `level-up` on any level gained;
  `quest { name }` on `quest:completed` and at login (`quest:is-complete`). A kill is credited
  from an NPC's death (`onNpcDeath`, to its killer) and from the shared credited-kill event
  `combat-achievements:kill { player, monster, amount? }` that scripted encounters emit for each
  rewarded player when no NPC dies (the Nightmare's ending transforms her) and some bosses emit
  beside the death, a singles boss under its main boss's name (Artio as Callisto); within one
  tick a task takes the larger of the two counts, so one kill reported both ways counts once and
  several kills in a tick all count. The generator derives a kill only when every NPC the task
  accepts is a cache NPC of that exact name and the description adds no place or condition
  ("Defeat a Goblin", "Defeat Cerberus 50 times", "Kill 5 Sand Crabs"; the alternatives its
  description lists join it: "Defeat Callisto or Artio 50 times", "Defeat The Nightmare or
  Phosani's Nightmare 50 times combined"; "in the Fremennik Province", "on Ungael", "without
  leaving" or Raging Echoes' "must be of one difficulty" leave the task unmapped, the places
  until the area unlocks exist, even for a boss with one home; a monster whose every location line
  on its Wiki page is the task's place, and whose name the cache gives one attackable monster, is
  killed there whatever the task adds: "Defeat a Drake in the Karuulm Slayer Dungeon", the pages
  saved as `<dir>/npcs/<page>.wikitext`; a Combat Achievements monster no NPC is named after is the
  NPCs that plugin counts for it, its `monsters.json` `npcs`: the Grotesque Guardians are Dusk;
  "Help the Shayzien house by dealing with 150 Lizardmen shaman" is their kills), a quest only when
  `plugins/quests/quests` registers that name, and a level only for a known skill; its report
  lists the kill tasks it could not map. To map more: add a kind (a trigger kind is a few lines in Triggers.LeagueTasks),
  a rule in the generator, or an entry in the overlay; or have the plugin that knows the deed emit
  `league:complete-task`. Everything else in the catalog is visible and counts once mapped.
- **Deeds** (`Actions.LeagueTasks.js`) listen to the events the skills already emit, counted per
  task in `league:task-progress` (task id -> count) until done (a trigger with an `area` counts
  only deeds done on its map there, where the player stands, `league:area-at`; a potion counts by
  its name without doses); `tests/league-task-deeds.test.cjs` drives each kind through the plugin
  doing the deed: `equip { items }` (any one worn)
  and `equip-all { items }` (all at once) on `equipment:changed` and at login; `produce { items,
  count }` from `skills:produced` (cooking, crafting, fletching, herblore, smithing, with its
  `amount`), `fishing:success`, `woodcutting:success`, `mining:success` and
  `runecrafting:success` (rolls x runes per essence), whatever the skill; `hunt { npcs, count }`
  from `hunter:success`; `pickpocket { npcs, count }` from `thieving:success` (pickpockets only);
  `clue { tier, count }` from `treasure-trails:casket-opened`; `agility-laps { courses, count }`
  from `agility:lap` (its `count`: a lap reward of several counts them all; "Complete a lap of /
  N laps of the X Agility Course", the course from the description's link or, where that names
  both Shayzien courses, the name; Yama's stepping stones); `eat { items, count }` from
  `food:eaten`, `drink { items, count }` from `potions:drunk` (the potion's name, any dose) or
  `food:eaten` (a drink that is food), `burn { items, count }` from `firemaking:success`,
  `burn-food { count }` from Cooking's `cooking:burnt`, `bury { items | any, count }` from
  Prayer's `prayer:buried` (by hand; pyre logs and a place are no plain count), `cast { spells,
  count }` from `magic:cast-committed` (a combat cast) and `magic:item-spell-cast` (an alchemy),
  named by the CombatSpells / EffectSpells keys (teleports, Lunar and Arceuus spells are not mapped:
  the server names no cast of theirs), `steal { stalls, items?, count, area? }` from
  `thieving:success` (a stall: its loc name, the item if named; a place other than a league area,
  or a stall no loc names, is left out), `pick { plants, count }` and `pick-each { plants: { plant:
  count } }` from Pickable's `world:picked` (Wheat for its grain), `collection-log { category,
  count }` (no category: the whole log, "Obtain 15 unique Collection Log slots"; a clue tier's
  Treasure Trails slots: "Fill 15 slots in the Hard Clue section", "Gain 10
  unique items from Reward casket (easy)") asked of the log's `collection-log:slots` when
  `collection-log:slot-filled` fills one and at login, `check-health { types | crops, count }` from
  `farming:check-health` (its crop type, or a cactus by its crop), `slayer-tasks { count }` from
  Slayer's `slayer:task-completed`, `superior-kills { count }` from `slayer:superior-killed` (on
  task or off), `temple-trek { difficulty, count }` from `temple-trekking:completed` (its own
  difficulty), `pest-control { boats, count }` from `pest-control:won` (a rewarded win; "or
  higher" the harder boats too), `prayer { prayers, count }` from `prayer:activated` (PrayerData's
  names; a prayer the server lacks is left out), `tempoross { count }` from `tempoross:subdued`
  (no NPC dies), `open-chest { chests, count }` from KeyChests' `chests:opened` (the crystal,
  enhanced crystal and Larran's chests by name), `plant { crops | patches, count }` from
  `farming:planted`, `harvest { crops, count }` from `farming:harvest` (a patch emptied, so a
  count of a crop is no harvest count), `foundry { quality?, count }` from
  `giants-foundry:sword-handed-in` (a successful sword: a ruined one, quality 0, is none),
  `plunder-chest { room, count }` from Pyramid Plunder's `pyramid-plunder:chest-searched`,
  `sepulchre-floor { floor, count }` from `hallowed-sepulchre:floor-completed`, `rumours { count }`
  from Hunter's `hunter:rumour-completed`, `random-event { events, count }` from the random
  events' `random-events:completed` (an event ended with its reward; a task whose name and Wiki
  description disagree, "Postie Pete" described as the Evil twin, is left out), `totem { woods,
  count }` from Vale Totems' `vale-totems:decorated` (a totem's final decoration), `dummy { count }`
  from the attack dummies' `dummies:hit`, `gather-with { skill, tools, items?, count, area? }` from
  `woodcutting:success`'s `axeId` and `mining:success`'s `pickaxeId` ("Chop any kind of logs using
  a steel axe"),
  `teleport { spells, count }` from `spell:teleport-arrival` (a teleport spell landed, by
  SpellTeleports' name: "Cast Kourend Castle Teleport", "Teleport to Civitas illa Fortis" with its
  spellbook, "Teleport Using Law Runes" every one whose runes have a law rune; the Lunar and Arceuus
  books' teleports name no arrival, Home Teleport is its own),
  `rifts { count }` from Guardians of the Rift's `guardians-of-the-rift:rift-closed` (its own total
  of rifts closed reaching the count: "Guardians of the Rift 10 Rifts closed"),
  `tob { modes, count }` from the Theatre of Blood's `tob:completed` (a raid of one of the modes:
  "on normal or hard mode 25 times"; the server's raid sends normal and entry),
  `emote { slots, count }` from the emotes plugin's `player:emote` (by the tab's slot; "Use the
  Fortis Salute emote", named as its locked emotes are in `emotes.json`),
  `take { items, source, count }` from ItemOnGroundManager's `ground-items:taken` (a ground item
  picked up, "pickup", or telegrabbed, "telegrab": "Pick up 10 White berries in Tirannwn", "Telegrab
  a Bloody bracer in Slepe"; a field's crop is a pick),
  `pickpocket-loot { npcs, items, count }` from Thieving's `thieving:loot` (that item in the
  pocket's loot: "Pickpocket an uncut diamond from a TzHaar-Hur", "a gnome for a King Worm"; a clue
  scroll is its tier's scroll or scroll box, as the pocket hands either),
  `bird-nest { count }` from Woodcutting's `woodcutting:nest-drop` ("Obtain a bird nest whilst
  cutting down trees"),
  `buy { items, shops, count }` from ShopManager's `shop:purchase` (that item bought from a shop of
  that name in `shops.json`, every variant of it: "Purchase an Uncut onyx from TzHaar-Hur-Lek's Ore
  and Gem Store"; an item's uncharged form is the one sold),
  `alch { coins, count }` from `magic:alchemy-completed`'s new `coins` (what the cast paid: "convert
  an item into 500 coins or more"),
  `bank { place, count }` from the bank's `bank:opened` (opened inside the place: "Use the Bank in
  Nardah" inside the Nardah bank page's square, "Bank at Mount Quidamortem" inside its bank's outline,
  "Use the Bank on Lunar Isle" anywhere on the island, which has one bank, "Use the Bank Chest inside
  Fortis Colosseum" in the lobby under it, the box round the walls around the Bank chest page's pin
  for it: a page's location lines, `{{ObjectLocLine|x:..,y:..}}`, are map points too),
  `npc-op { npcs, option, count }` from the NPC option listener's new `npc:operated` { player, npc,
  npcId, option } (a menu option something answered: a Talk-to that started a dialogue, a Pet;
  "Nothing interesting happens" is none): "Talk to a Gladiator (Fortis Colosseum)", "Talk to Ilfeen in
  Tirannwn", "Talk to the Mysterious Old Man in Falador", "Pet Renu"; every cache NPC of the name
  with that option is one of the linked NPC page's ids (`<dir>/npcs/<page>.wikitext`), so the name
  is that NPC,
  `shortcut { shortcuts, count }` from the Agility plugin's `agility:obstacle`, now with the
  shortcut's own name (`agility-shortcuts.json`'s; a course obstacle has none): "Use the Stepping stone
  (Shilo Village) in Shilo Village", "Cross a Pillar (Revenant Caves) in the Revenant Caves" (any of
  the easy, medium and hard pillars; the place only says where it is),
  `deed { event, items?, where?, count }` from a content plugin's own event of one deed, the generator's
  table naming the event for the task's name and description (its `itemId` one of the items when the
  trigger names them): "Worship the Ectofuntus" (`ectofuntus:worshipped`), "Fill a Large / Giant
  Pouch" (`runecrafting:pouch-filled`, essence put in that pouch), "Activate an Imbued Heart"
  (`imbued-heart:invigorated`), "Load a blowpipe with Rune / Dragon Darts"
  (`toxic-blowpipe:darts-loaded`, those darts, unpoisoned), "Open a Looting Bag" (`looting-bag:opened`),
  "Activate an Arcane or Dexterous Prayer Scroll" (`prayer:scroll-read`, either scroll read),
  "Switch to the Lunar Spellbook" (`MagicSpellbook.changeSpellbook`'s new `magic:spellbook-changed`
  { spellbook: "lunar" }, `where` the event's own fields), "Turn off your run" (the run toggle's new
  `player:run-toggled` { running: false }), "Perform a Special Attack", "Use the Special Attack of a Dragon Axe", "Blow the
  Soulflame Horn" (`CombatSpecial.drain`'s new `combat-special:performed`, its `itemId` the weapon
  wielded), "Set Up a Dwarf Cannon" (`dwarf-cannon:set-up`, the fourth part on), "Rake a Flower
  Patch" (Farming's `farming:raked` { patchType: "FLOWER" }), "Fill a Bucket With Supercompost"
  (`farming:bin-taken`, a bucket filled at the bin),
  `pet { skilling, count }` from Pets'
  `pets:obtained` (a skilling pet has its skill; "any Boss Pet" is left out, a boss pet being
  told apart from no other pet without a skill), and `eat-heal { heal }` from `food:eaten`'s `restores` (what
  the food restores, at full health too): "Eat / Drink a X" by the description's item or else the
  name's, a place ("in Auburn Valley", "from a bird bath") none. The generator derives them from the
  name and the Wiki's description, read with its links' targets (something worn in a league area,
  "while inside" too, is an equip task with an `area`, checked as it goes on and as the player
  crosses into a map square; a set an equip task names is the
  cache's item set, enum 1034's pieces as the Grand Exchange's set exchange reads them: "a full set
  of Ahrim the Blighted's equipment" every piece, "any piece of the Justiciar Armour set" any,
  "a full set of any Barrows equipment" one whole Barrows set (`equip-any-set { sets }`); a set the
  cache has no item set for is its Wiki page's (the description's link, saved as
  `<dir>/sets/<page>.wikitext`): its `{{Infotable Bonuses}}` or `{{Skill outfit}}` table of pieces,
  or the pieces its `{{Infobox Set}}` pictures link to, every one a cache item ("a full set of Armadyl
  armour"; Void Knight's three tables, one per helm, are three whole sets; tables that share no piece,
  Crystal armour's weapons, armour and tools, leave it unmapped), and a
  Barrows "piece of armour" is no weapon; an equip-all slot may be "either
  some platelegs or a plateskirt"; a worn item is as the cache spells it, "Seer's Ring" the Seers
  ring, "vambs" vambraces; what only restates the deed is
  dropped first: "whilst fishing", a rune's "from Essence at the Fire Altar", where something worn
  comes from ("Amy's Saw from Mahogany Homes", "a Pearl fishing rod, purchased from Alry"), the
  tree logs come from ("Chop 75 Magic Logs from Magic Trees"); a produce task's
  trailing league region is its `area`; a subject the name doesn't resolve is taken from the
  description: "Clean a Grimy Guam" is the guam leaf, "Equip an Enchanted Slayer Staff" its "Slayer's
  staff (e)", "a pair of Dragon Claws"; a linked subject whose title is no cache name is what the
  linked page's infobox names (`<dir>/subjects/<page>.wikitext`, the redirect followed), when every
  cache entry of that name, less banknotes and placeholders, is one of the page's ids: "Mithril
  Grapple" would be the Mith grapple but the unfinished grapple shares the name, "Red chinchompa
  (Hunter)" is the Carnivorous chinchompa, "Granite" any of its three weights, "the Webweaver" either
  Webweaver bow (no Chompy bird hat rank is one: every rank's hat has the one name); "Chop down an
  arctic pine tree" is its logs; "Ferment" makes wine; a tree chopped is its logs; a boss "in" its
  own lair, a Combat Achievements monster, is just its kills: "Defeat Vorkath on Ungael 50 times";
  a minigame or group encounter completed is the monster its plugin credits (also the Moons of
  Peril, the Royal Titans, the Wintertodt), `credited` so a death of the same name
  elsewhere is none: the Gauntlets' Hunllefs, the Fight Cave's TzTok-Jad, the Inferno's TzKal-Zuk,
  Tombs of Amascut's normal and expert raids) ("[[Oathplate chest|chest]]" is
  the Oathplate chest): "Equip a/an X" and the description's list ("either A, B or C" any one, "A,
  B and C" all); "Catch / Chop / Mine / Cook / Craft / Fletch / Smelt / Smith / Make / Create /
  Brew / Clean / Cut / Spin [N] X" ("Successfully" before it is the deed; a potion's name without
  "potion", whatever its dosage) as an item made (a fish caught raw, a herb counted clean; a catch with
  no raw fish is a creature hunted); "Pickpocket X [N times]" with the description's
  alternatives; "N <tier> Clue Scroll(s)". A description naming a group ("any kind of logs"), a
  place or a condition leaves the task unmapped; so does a parenthesis remark, while one without a
  space is part of a name ("(c)", "(u)").
- **Named places** (the catalog's `places`, by key: a guild, a dungeon, an island, each `{ name,
  page, source, rects }`, boxes of tiles on any plane): a task's place that is no league area
  ("Enter the Crafting Guild", "Defeat a runite golem inside the Wilderness Resource Area") is a
  `place` on its trigger when the generator's place table knows its bounds, each from one source
  checked against another: the Wiki page's own outline (`{{Map|mtype=polygon}}`, or its
  `square` or `rectangle` as Module:Map draws them; the tiles whose centre it holds), the server's Slayer areas (`slayer-areas.json`, less any other area's box that
  overlaps), or the tiles the cache's walls, fences and shores enclose around the page's map point
  (with what they surround; an island in open sea its box); every place must hold one of its page's
  map points, or every spawn of the NPCs it lists. The pages are saved as
  `<dir>/places/<page>.wikitext`, and a place is at most 192 boxes. A trigger with a `place` counts
  only deeds done, and kills made, inside it: a kill ("in the Wilderness Resource Area"), a
  produce ("Cook 20 Sharks in Darkmeyer", "Craft a Lava Rune at the Fire Altar"; the name's and the
  description's place must agree) or a theft ("Steal a Chisel from a crafting stall in Keldagrim";
  "Thieve" is "Steal"). `enter { place }`: the player inside it, each of its
  boxes a zone (`onZoneEnter`, so a step, a teleport or a login there counts): "Enter the X" or
  "Visit X" whose description names the same place ("in the Kebos Lowlands", where it lies, says
  nothing more). A place without such bounds stays unmapped.
- **One of each**: `kill-each { npcs: { name: count }, area? }`, that many deaths of each NPC,
  counted per NPC in `league:task-kills` ("Defeat a Moss giant, Fire giant & Hill Giant in Kourend",
  every one a cache NPC, the league area that follows).
- **Kills in a league area**: a kill task whose place is a league area ("Defeat a Snake in
  Karamja", "on Karamja", "within Morytania", "in the Fremennik Province", "in Varlamore
  underground") gets `area`, the areas plugin's id (`league-areas.json`; the task list's own enum
  numbers Kourend 10, the map 20), and counts only kills whose tile `league:area-at` puts there
  (the death's tile, or the player's for a credited kill).
- **Experience** (`Triggers.LeagueTasks.js`): `experience { skills, amount, count }`, at least
  `amount` XP in `count` of the skills, on `onExperienceGained` and at login. "Obtain N Million
  <Skill> XP"; "... XP in a combat skill" takes the description's list (Prayer is in the 100
  million one's); "... in any non-combat skill" and "... in N non-combat skills" every skill but
  the six the description excludes (Sailing left out).
- **Diaries**: `diary { diary, tier }` ("Complete the Easy Ardougne Diary", "Kourend and Kebos Hard
  Diary Tasks"; the diaries plugin's keys), complete when `diary:is-complete` says so, checked after
  every `diary:task` (the diaries plugin, loaded first, has counted it) and at login. A kill
  task's league area may come from its description too ("Defeat Callisto": "... in the
  Wilderness").
- **Combat Achievements**: `ca-tier { tier }` ("Combat Achievements Easy Tier", the plugin's
  `combat-achievements:tier`), `ca-count { count, type? }` ("100 Combat Achievements", "Complete
  5 Speed Tasks"), `ca-bosses { count }` ("Complete all tasks for 3 bosses") and `ca-boss
  { monster }` ("Kraken Combat Achievements": a monster of enum 3970, the plugin's list; a group
  such as "all three Dagannoth Kings" is left unmapped), from the plugin's new
  `combat-achievements:summary` { player } -> completed, speed, monsters, checked on
  `combat-achievements:completed` and at login. "Within the areas you have unlocked" is not
  checked.
- **Not mapped yet:** kills and deeds with a condition (a time, a streak, the weapon or spell used),
  places with no sourced bounds (open towns, regions), open groups ("any Dragon weapon"), items
  obtained (drops, rewards), transport without an arrival signal, the minigame steps and
  interactions whose plugins emit no event (a dialogue's trade or service, a quest-only step, house
  building), deeds whose content is not built here (most animals' Pet, the grubby, muddy and moon
  chests, STASH units, sacred eel dissection), and names the cache gives several things (every Chompy
  bird hat rank's); the Leagues tutorial's tasks are completed by the tutorial itself.

## Developer commands

- `::league [player]` - the character's league and points.
- `::leaguetask <id> [points] [name]` - complete a catalog task by its id, or award an ad-hoc task
  with the points given, through the real award path.
- `::leaguetasks <search>` - find a league's tasks by name or id, with tier, points and whether done.
- `::relic [tier 1-8] [slot 1-3]` - list your relics, or choose one through the usual checks.
- `::leaguerecords <trophies|statistics|rankings|firsts>` - open a main-game record screen.
- `::leagueshop` - open the Leagues Reward Shop.
- `::mastery` - your combat masteries, points and challenges; `::mastery <melee|ranged|magic>
  <tier 1-6>` unlocks one through the usual checks; `::mastery point <1-10>` awards a challenge's
  point through the real path (the only way to the Echo boss challenges here).
- `::areas [id or name]` - list your areas, the next unlock and the area you stand in, or unlock
  one through the usual checks (`::area` is AdminCommands' Area-class debug).
- `::renown <amount> [player]` - grant Shattered Relics' Sage's Renown.

## Not yet

Most task triggers (see Tasks), the Echo bosses (and so three of the mastery points), the tier
passives left out above (clue-step progress and farming ticks), the boosted sources their own
plugins have yet to ask about, and Shattered Relics' rules (see its section). Each is its own item
on the progress tracker.
Of the relics, Overgrown's automatic harvest and replanting and Pocket Kingdom's hourly cycle are
their own items, as are the relics this cache cannot carry (Not in this cache, above).

The records have no POH league hall to stand in: its trophy case, pedestals and scroll need the
house's league hall, which this server doesn't build yet, so the scroll's options answer only where
the loc exists.

The cache's "League Skill Cape Shop" (652) is not a shop: its only script (3201) creates 22 tiny
cape items and prints "Loading: <cape>" for each, a model preloader. Nothing sells through it, and
the Wiki names no such shop.

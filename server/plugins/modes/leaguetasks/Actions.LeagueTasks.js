/**
 * Awarding the tasks named by a deed rather than a kill or a level (docs/leagues.md, Tasks): each
 * kind listens to the events the skills and content already emit, so no task is named here.
 *
 * - `equip { items }`: any of the items worn, `equip-all { items }` every one of them at once (an
 *   entry that is a list takes any of its items), `equip-any-set { sets }` every piece of one of the
 *   sets, on
 *   `equipment:changed` (every worn-items refresh) and at login.
 * - `equip-each { items, any? }`: every one of the items worn at some point, `any` any one of them
 *   completing alone (the ones sharing a slot - five godswords, six god books - cannot be worn at
 *   once, so they are collected over time); `equip-count { items, count }`: that many different ones
 *   of the items over time ("N unique Echo Items"). Both keep what has been worn in
 *   `league:task-worn` (task id -> the worn units' keys), so the same item worn twice does not count
 *   twice and the progress survives a logout. A unit is an item name, an item id, or a list of
 *   either ("any of"); every equip kind understands all three, and `count` on a plain `equip` is the
 *   stack size the item must be worn with ("a stack of at least 100 Black Chinchompas").
 * - `produce { items, count }`: that many of the items made or gathered, whatever the skill:
 *   `skills:produced` { itemId, amount } (cooking, crafting, fletching, herblore, smithing),
 *   `fishing:success` { itemId }, `woodcutting:success` { logId, logAmount? }, `mining:success` { itemId } and
 *   `runecrafting:success` { runeId, rolls, amountPerEssence }.
 * - `hunt { npcs, count }`: creatures caught, `hunter:success` { npcId }.
 * - `pickpocket { npcs, count }`: pockets picked, `thieving:success` { method: "pickpocket", target }.
 * - `clue { tier, count }`: reward caskets of the tier opened, `treasure-trails:casket-opened` { tier }.
 * - `eat { items, count }`: the food eaten, `food:eaten` { itemId }; `drink { items, count }`: the
 *   potion drunk (by its name, without doses), `potions:drunk` { name }, or a drink that is food
 *   (moon-lite, a LizardKicker), `food:eaten`; `eat-heal { heal }`: a food that restores at least
 *   that much, `food:eaten` { restores }.
 * - `burn { items, count }`: logs lit for a fire, `firemaking:success` { itemId }; `burn-food
 *   { count }`: food burnt cooking it, `cooking:burnt`; `bury { items | any, count }`: bones buried,
 *   `prayer:buried` { itemId } (by hand, not a bonecrusher's).
 * - `cast { spells, count }`: a spell whose cost is paid, `magic:cast-committed` { spell } (a
 *   combat cast) or `magic:item-spell-cast` { spell } (an alchemy), named
 *   by the server's own spell registries (CombatSpells, EffectSpells: ICE_BURST is Ice Burst,
 *   LOW_ALCHEMY Low Level Alchemy).
 * - `steal { stalls, items?, count }`: a theft from one of the stalls (by its loc name), of one of
 *   the items if listed, `thieving:success` { method: "stall", stall, itemId }.
 * - `pick { plants, count }`: a field's crop picked (by the plant: Wheat for its grain),
 *   `world:picked` { plant }; `pick-each { plants: { plant: count } }`: each of them that many.
 * - `obtain { items, count }`: the named items obtained from any source that reports one - a logged
 *   obtain (`collection-log:obtain`: NPC drops, minigame and content rewards, shops), an actually
 *   awarded loot roll (`npc-drops:roll`: Zalcano, the Revenants), a Motherlode Mine nugget, a mined
 *   gem, a fishing casket or an old boot, a searched bird's nest seed, a coin pouch's coins, a Target
 *   round's score, a Miscellania collection, a Fortis Colosseum run's Glory, or the Rogue's Castle
 *   chest's loot - counted by amount; an `amount` task ("at least N") is satisfied by one source.
 *   `obtain-all { items }`: every one of the items obtained at some point, the ones gathered kept in
 *   `league:task-obtained` (a same-numbered boot twice counts once; "Obtain every Revenant weapon").
 * - `coin-pouch { coins }`, `archery-target { points }`, `miscellania { approval }`,
 *   `colosseum-glory { glory }`, `motherlode-nuggets { count }`, `nest-seed { items }`: a single
 *   source event of that kind reaching the amount ("Open a stack ... at least 800 Coins",
 *   "Achieve 250 points", "an approval rating of 100%", "Obtain 40,000 Glory", "Obtain 20 Golden
 *   Nuggets", "a Magic seed ... from a birds nest").
 * - `collection-log { category, count }`: that many of the category's slots filled, asked of the
 *   log (`collection-log:slots`) when one fills (`collection-log:slot-filled`) and at login.
 * - `check-health { types | crops, count }`: a grown crop's health checked, by the farming
 *   plugin's crop type (FRUIT_TREE, TREE, CALQUAT...) or crop (CACTUS), `farming:check-health`.
 * - `slayer-tasks { count }` (`slayer:task-completed`), `superior-kills { count }`
 *   (`slayer:superior-killed`), `temple-trek { difficulty, count }` (`temple-trekking:completed`),
 *   `pest-control { boats, count }` (`pest-control:won`).
 * - `prayer { prayers, count }`: a prayer switched on, `prayer:activated` { prayerId }, named as
 *   PrayerHandler's PrayerData names it ("Protect from Melee").
 * - `pet { skilling, count }`: a new pet, a skilling pet's if `skilling`, `pets:obtained` { skill }.
 * - `tempoross { count }`: Tempoross subdued, `tempoross:subdued`; `open-chest { chests, count }`: a
 *   key chest opened, by its name, `chests:opened`.
 * - `plant { crops | patches, count }` (`farming:planted`), `harvest { crops, count }`
 *   (`farming:harvest`, a patch emptied), `foundry { quality?, count }`
 *   (`giants-foundry:sword-handed-in`), `plunder-chest { room, count }`
 *   (`pyramid-plunder:chest-searched`), `sepulchre-floor { floor, count }`
 *   (`hallowed-sepulchre:floor-completed`), `rumours { count }` (`hunter:rumour-completed`),
 *   `random-event { events, count }` (`random-events:completed`, by the event's kind),
 *   `totem { woods, count }` (`vale-totems:decorated`), `dummy { count }` (`dummies:hit`),
 *   `gather-with { skill, tools, items?, count }` (`woodcutting:success`'s axeId, `mining:success`'s pickaxeId),
 *   `teleport { spells, count }` (`spell:teleport-arrival`, by SpellTeleports' lower-cased name),
 *   `rifts { count }` (`guardians-of-the-rift:rift-closed`'s own total of rifts closed),
 *   `prayer-restore { amount, count }` (`altars:prayed`'s `restored`, one prayer restoring at least that),
 *   `tob { modes, count }` (`tob:completed`, a raid of one of the modes), `emote { slots, count }`
 *   (`player:emote`, by the emote tab's slot), `take { items, source, count }` (`ground-items:taken`,
 *   picked up by hand, "pickup", or by Telekinetic Grab, "telegrab"), `pickpocket-loot { npcs, items,
 *   count }` (`thieving:loot`, the pocket's loot holding one of the items), `bird-nest { count }`
 *   (`woodcutting:nest-drop`, a nest from a tree), `buy { items, shops, count }` (`shop:purchase`, that
 *   item bought from one of those shops, by their names), `alch { coins, count }`
 *   (`magic:alchemy-completed`, an alchemy paying at least that many coins), `bank { place, count }`
 *   (`bank:opened`, the bank opened inside the place: a town's bank), `npc-op { npcs, option, count }`
 *   (`npc:operated`, a menu option, "talk-to" or "pet", that something answered on an NPC of the name),
 *   `object-op { objects?, objectIds?, option?, place?, area?, count }` (`object:operated`, a menu
 *   option something answered on a loc: the cache ids and/or the loc's names, the option lower-cased:
 *   "open", "fill"; a task naming neither the ids nor the names takes any loc, one naming only the
 *   option that option's locs),
 *   `item-op { items?, itemIds?, option?, amount?, count }` (`item:operated`, an item's own inventory
 *   action something answered - its cache id and/or name, the option lower-cased: "open", "open-all";
 *   an `amount` the one action must have covered at once, "28 Coin Pouches at once"),
 *   `shortcut { shortcuts, count }` (`agility:obstacle`'s `shortcut`, an agility shortcut crossed, by
 *   its name in agility-shortcuts.json).
 * - `deed { event, items?, where?, count }`: a content plugin's own event of the deed (the generator's
 *   table names it: `ectofuntus:worshipped`, `runecrafting:pouch-filled`), its `itemId` one of the items
 *   if the trigger names them, its other fields the `where` values.
 * - `agility-laps { courses, count }`: laps of any of the courses (the agility plugin's keys),
 *   `agility:lap` { course, count }; Yama's stepping stones count each stone as a lap.
 *
 * - `enter { place }`: the player inside one of the catalog's named places (its boxes, zones).
 *
 * A trigger with an `area` counts only deeds done there (`league:area-at`, the player's tile), one
 * with a `place` only inside that place's bounds.
 *
 * Counts toward a task are kept per task in `league:task-progress` (task id -> count) until it
 * completes; a deed no open task accepts is not kept.
 */
const Common = require("./Common.LeagueTasks");
const Complete = require("./Complete.LeagueTasks");

/** Progress toward open counted tasks: task id -> count. */
const PROGRESS_ATTRIBUTE = "league:task-progress";
/** The items worn over time toward open `equip-each` / `equip-count` tasks: task id -> { unit index: 1 }. */
const WORN_ATTRIBUTE = "league:task-worn";
/** The items obtained over time toward open `obtain-all` tasks: task id -> { item id: 1 } (persisted). */
const OBTAINED_ATTRIBUTE = "league:task-obtained";

/** League type -> { equip, eatHeal: tasks; produce, hunt, pickpocket, clue, laps, eat, drink: Map(lower-cased name -> tasks) }. */
const index = new Map();

/** Lower-cased, without a potion's doses ("Strength potion(4)" is the Strength potion). */
const key = (name) => String(name ?? "").toLowerCase().replace(/\(\d\)$/, "");

function add(map, name, task) {
  map.set(key(name), (map.get(key(name)) ?? []).concat(task));
}

function indexOf(type) {
  if (index.has(type)) return index.get(type);
  const entry = { enter: new Map(), deeds: new Map(), rifts: [], equip: [], produce: new Map(), hunt: new Map(), pickpocket: new Map(), clue: new Map(), laps: new Map(), eat: new Map(), drink: new Map(), eatHeal: [], burn: new Map(), bury: new Map(), buryAny: [], burnFood: [], cast: new Map(), steal: [], pick: new Map(), pickEach: [], collectionLog: [], checkHealth: new Map(), events: new Map(), prayer: new Map(), obtain: new Map(), obtainAll: [] };
  for (const task of Common.catalog(type).tasks) {
    const trigger = task.trigger;
    if (trigger?.kind === "enter") entry.enter.set(trigger.place, (entry.enter.get(trigger.place) ?? []).concat(task));
    else if (trigger?.kind === "rifts") entry.rifts.push(task);
    else if (EQUIP_KINDS.has(trigger?.kind)) entry.equip.push(task);
    else if (trigger?.kind === "produce") for (const item of trigger.items ?? []) add(entry.produce, item, task);
    else if (trigger?.kind === "hunt") for (const npc of trigger.npcs ?? []) add(entry.hunt, npc, task);
    else if (trigger?.kind === "pickpocket") for (const npc of trigger.npcs ?? []) add(entry.pickpocket, npc, task);
    else if (trigger?.kind === "clue") add(entry.clue, trigger.tier, task);
    else if (trigger?.kind === "eat" || trigger?.kind === "drink") for (const item of trigger.items ?? []) add(entry[trigger.kind], item, task);
    else if (trigger?.kind === "eat-heal") entry.eatHeal.push(task);
    else if (trigger?.kind === "burn") for (const item of trigger.items ?? []) add(entry.burn, item, task);
    else if (trigger?.kind === "bury" && trigger.any) entry.buryAny.push(task);
    else if (trigger?.kind === "bury") for (const item of trigger.items ?? []) add(entry.bury, item, task);
    else if (trigger?.kind === "burn-food") entry.burnFood.push(task);
    else if (trigger?.kind === "steal") entry.steal.push(task);
    else if (trigger?.kind === "pick") for (const plant of trigger.plants ?? []) add(entry.pick, plant, task);
    else if (trigger?.kind === "pick-each") entry.pickEach.push(task);
    else if (trigger?.kind === "collection-log") entry.collectionLog.push(task);
    else if (trigger?.kind === "obtain") for (const item of trigger.items ?? []) add(entry.obtain, item, task);
    else if (trigger?.kind === "obtain-all") entry.obtainAll.push(task);
    else if (trigger?.kind === "deed") entry.deeds.set(trigger.event, (entry.deeds.get(trigger.event) ?? []).concat(task));
    else if (EVENT_KINDS.has(trigger?.kind)) add(entry.events, trigger.kind, task);
    else if (trigger?.kind === "prayer") for (const prayer of trigger.prayers ?? []) add(entry.prayer, prayer, task);
    else if (trigger?.kind === "check-health") {
      for (const cropType of trigger.types ?? []) add(entry.checkHealth, `type:${cropType}`, task);
      for (const crop of trigger.crops ?? []) add(entry.checkHealth, `crop:${crop}`, task);
    }
    else if (trigger?.kind === "cast") for (const spell of trigger.spells ?? []) add(entry.cast, spell, task);
    else if (trigger?.kind === "agility-laps") for (const course of trigger.courses ?? []) add(entry.laps, course, task);
  }
  index.set(type, entry);
  return entry;
}

function progressOf(player) {
  const value = player.getAttribute(PROGRESS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** `amount` toward each open task of `kind` that accepts `name`; a task that reaches its count completes. */
function count(player, kind, name, amount = 1) {
  const type = Common.leagueOf(player);
  if (type === null || !(amount > 0)) return;
  countTasks(player, type, indexOf(type)[kind].get(key(name)), amount);
}

/** `amount` toward each of `tasks` still open (and done in its area); the ones reaching their count complete. */
function countTasks(player, type, tasks, amount = 1) {
  if (!tasks?.length) return;
  const done = new Set(Common.completedIds(player));
  const open = tasks.filter((task) => !done.has(task.id) && inArea(player, type, task));
  if (!open.length) return;
  const progress = { ...progressOf(player) };
  const reached = [];
  for (const task of open) {
    const total = (Number(progress[task.id]) || 0) + amount;
    if (total >= (Number(task.trigger.count) || 1)) {
      delete progress[task.id];
      reached.push(task);
    } else progress[task.id] = total;
  }
  player.setAttribute(PROGRESS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}

/**
 * A task with an `area` (the areas plugin's id: "Chop 100 Maples in Tirannwn") counts only deeds
 * done on its map there, where the player stands (`league:area-at`, as kill tasks); one with a
 * `place` only deeds done inside the place's bounds.
 */
function inArea(player, type, task) {
  if (task.trigger.area === undefined && task.trigger.place === undefined) return true;
  const at = player.getLocation?.();
  if (!at) return false;
  if (task.trigger.place !== undefined && !Common.inPlace(task.trigger.place, at.getX(), at.getY())) return false;
  if (task.trigger.area === undefined) return true;
  const query = { x: at.getX(), y: at.getY(), league: type, area: null };
  Common.api.emitCustomEvent("league:area-at", query);
  return query.area === task.trigger.area;
}

function itemName(id) {
  return Number.isInteger(id) && id >= 0 ? Common.core.CacheDefinitions.getItem(id)?.name ?? null : null;
}

function npcName(id) {
  return Number.isInteger(id) && id >= 0 ? Common.core.CacheDefinitions.getNpc(id)?.name ?? null : null;
}

function objectName(id) {
  return Number.isInteger(id) && id >= 0 ? Common.core.CacheDefinitions.getObject(id)?.name ?? null : null;
}

/** The kinds awarded by what is worn (see the head), all checked on `equipment:changed` and at login. */
const EQUIP_KINDS = new Set(["equip", "equip-all", "equip-any-set", "equip-each", "equip-count"]);

/** What the player wears, by item name (`key`) and by cache id: a unit a trigger names. */
function wornIndexOf(player) {
  const byName = new Map();
  const byId = new Map();
  for (const item of player.getEquipment().getItems()) {
    if (!item || item.getId() < 0) continue;
    const id = item.getId();
    byId.set(id, item);
    const name = itemName(id);
    if (name) byName.set(key(name), item);
  }
  return { byName, byId };
}

/** Whether a trigger unit (an item name, a cache item id, or a list meaning "any of") is worn. */
function wornUnit(worn, unit) {
  if (Array.isArray(unit)) return unit.some((each) => wornUnit(worn, each));
  if (typeof unit === "number") return worn.byId.has(unit);
  return worn.byName.has(key(unit));
}

/** The amount a unit is worn with (a stack of chinchompas), 0 when it is not; an item is at least one. */
function wornAmount(worn, unit) {
  if (Array.isArray(unit)) return Math.max(0, ...unit.map((each) => wornAmount(worn, each)));
  const item = typeof unit === "number" ? worn.byId.get(unit) : worn.byName.get(key(unit));
  if (!item) return 0;
  const amount = item.getAmount?.();
  return Number.isFinite(amount) ? Math.max(0, amount) : 1;
}

/** The worn-over-time units kept for the open equip tasks (task id -> { unit index: 1 }), persisted. */
function wornOf(player) {
  const value = player.getAttribute(WORN_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function checkWorn(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const tasks = indexOf(type).equip;
  if (!tasks.length) return;
  const worn = wornIndexOf(player);
  const done = new Set(Common.completedIds(player));
  let store = null;
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(player, type, task)) continue;
    const { kind, items, sets, count } = task.trigger;
    if (kind === "equip-any-set") {
      // Every piece of one of the sets, worn at once (Void Knight's three helms share a top and robe).
      if (sets.some((set) => set.every((unit) => wornUnit(worn, unit)))) Complete.complete(player, task.id, type);
      continue;
    }
    if (kind === "equip") {
      // Any one of the items worn; a `count` is the stack it must be worn with ("100 Black Chinchompas").
      if (items.some((unit) => wornUnit(worn, unit) && wornAmount(worn, unit) >= (Number(count) || 1))) Complete.complete(player, task.id, type);
      continue;
    }
    if (kind === "equip-all") {
      // Every entry worn at once; an entry that is a list takes any of its items ("either legs or skirt").
      if (items.every((unit) => wornUnit(worn, unit))) Complete.complete(player, task.id, type);
      continue;
    }
    // equip-each / equip-count: gathered over time, so items sharing a slot (five godswords, six god
    // books, the three Cerberus boots) all count. Each worn unit is kept once, so wearing the same one
    // again is no new unit, and the progress is persisted (a logout does not lose it).
    store ??= { ...wornOf(player) };
    const seen = { ...(store[task.id] && typeof store[task.id] === "object" ? store[task.id] : {}) };
    items.forEach((unit, index) => { if (wornUnit(worn, unit)) seen[index] = 1; });
    const alternatives = task.trigger.any === undefined ? [] : [].concat(task.trigger.any);
    const reached = (kind === "equip-count"
      ? Object.keys(seen).length >= Math.max(1, Number(count) || 1)
      : items.every((_unit, index) => seen[index] === 1))
      || alternatives.some((unit) => wornUnit(worn, unit));
    if (reached) { delete store[task.id]; Complete.complete(player, task.id, type); }
    else store[task.id] = seen;
  }
  if (store) player.setAttribute(WORN_ATTRIBUTE, store);
}

function equipmentChanged({ player }) {
  if (player) checkWorn(player);
}

function produced({ player, itemId, amount }) {
  if (player) count(player, "produce", itemName(itemId), Number(amount ?? 1));
}

function gathered({ player, itemId }) {
  if (player) count(player, "produce", itemName(itemId));
}

function chopped({ player, logId, logAmount = 1 }) {
  if (player) count(player, "produce", itemName(logId), logAmount);
}

function crafted({ player, runeId, rolls, amountPerEssence }) {
  if (player) count(player, "produce", itemName(runeId), (Number(rolls) || 1) * (Number(amountPerEssence) || 1));
}

function hunted({ player, npcId }) {
  if (player) count(player, "hunt", npcName(npcId));
}

function stole({ player, method, target, stall, itemId }) {
  if (!player) return;
  if (method === "pickpocket") count(player, "pickpocket", target);
  if (method !== "stall") return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const stolen = key(itemName(itemId));
  const tasks = indexOf(type).steal.filter((task) => task.trigger.stalls.some((each) => key(each) === key(stall))
    && (!task.trigger.items || task.trigger.items.some((each) => key(each) === stolen)));
  countTasks(player, type, tasks);
}

function casket({ player, tier }) {
  if (player) count(player, "clue", tier);
}

function ate({ player, itemId, restores }) {
  if (!player) return;
  const name = itemName(itemId);
  count(player, "eat", name);
  count(player, "drink", name);
  const type = Common.leagueOf(player);
  if (type === null) return;
  for (const task of indexOf(type).eatHeal) {
    if (Number(restores) >= Number(task.trigger.heal)) Complete.complete(player, task.id, type);
  }
}

function drank({ player, itemId, name }) {
  if (player) count(player, "drink", name ?? itemName(itemId));
}

function burnt({ player, itemId }) {
  if (player) count(player, "burn", itemName(itemId));
}

function burntFood({ player }) {
  const type = player ? Common.leagueOf(player) : null;
  if (type !== null) countTasks(player, type, indexOf(type).burnFood);
}

function buried({ player, itemId }) {
  if (!player) return;
  count(player, "bury", itemName(itemId));
  const type = Common.leagueOf(player);
  if (type !== null) countTasks(player, type, indexOf(type).buryAny);
}

/** Spell object -> its name, from the server's spell registries' keys (ICE_BURST: "ice burst"). */
let spellNames = null;
const SPELL_ALIASES = { LOW_ALCHEMY: "low level alchemy", HIGH_ALCHEMY: "high level alchemy" };

function spellName(spell) {
  if (!spellNames) {
    spellNames = new Map();
    for (const registry of [Common.core.CombatSpells, Common.core.EffectSpells]) {
      for (const key of Object.getOwnPropertyNames(registry ?? {})) {
        const value = registry[key];
        if (value && typeof value === "object" && typeof value.spellId === "function") {
          spellNames.set(value, SPELL_ALIASES[key] ?? key.toLowerCase().replace(/_/g, " "));
        }
      }
    }
  }
  return spellNames.get(spell) ?? null;
}

function cast({ player, spell }) {
  const name = player ? spellName(spell) : null;
  if (name) count(player, "cast", name);
}

/** A crop picked: its `pick` tasks, and each `pick-each` task that wants it, counted per plant. */
function picked({ player, plant }) {
  if (!player) return;
  count(player, "pick", plant);
  const type = Common.leagueOf(player);
  if (type === null) return;
  const done = new Set(Common.completedIds(player));
  for (const task of indexOf(type).pickEach) {
    const wanted = Object.entries(task.trigger.plants).find(([name]) => key(name) === key(plant));
    if (!wanted || done.has(task.id)) continue;
    const progress = { ...progressOf(player) };
    const counts = { ...(progress[task.id] && typeof progress[task.id] === "object" ? progress[task.id] : {}) };
    counts[wanted[0]] = Math.min(Number(wanted[1]), (Number(counts[wanted[0]]) || 0) + 1);
    const complete = Object.entries(task.trigger.plants).every(([name, need]) => (Number(counts[name]) || 0) >= Number(need));
    if (complete) delete progress[task.id];
    else progress[task.id] = counts;
    player.setAttribute(PROGRESS_ATTRIBUTE, progress);
    if (complete) Complete.complete(player, task.id, type);
  }
}

/** Each open `collection-log` task whose category has its count of slots filled completes. */
function checkCollectionLog(player, type) {
  const tasks = indexOf(type).collectionLog;
  if (!tasks.length) return;
  const done = new Set(Common.completedIds(player));
  const slots = new Map();
  for (const task of tasks) {
    if (done.has(task.id)) continue;
    const category = task.trigger.category ?? null;
    if (!slots.has(category)) {
      const query = { player, category, count: null };
      Common.api.emitCustomEvent("collection-log:slots", query);
      slots.set(category, Number(query.count) || 0);
    }
    if (slots.get(category) >= Number(task.trigger.count)) Complete.complete(player, task.id, type);
  }
}

function logged({ player }) {
  const type = player ? Common.leagueOf(player) : null;
  if (type !== null) checkCollectionLog(player, type);
}

function checkedHealth({ player, type, crop }) {
  if (!player) return;
  count(player, "checkHealth", `type:${type}`);
  count(player, "checkHealth", `crop:${crop}`);
}

/**
 * `obtain { items, count?, source? }`: the named items obtained, counted by amount. A source is
 * told apart so a deed is not credited from the wrong one: "logged" (any `collection-log:obtain`:
 * NPC drops, minigame and content rewards, shops), "drop" (an actually awarded `npc-drops:roll`:
 * Zalcano, the Revenants), "mining" (`mining:gem`: a rock's gem pre-roll), "geode"
 * (`treasure-trails:clue-item`: a clue geode), "fishing" (`fishing:junk`: a casket, an old boot),
 * "impling" / "crystal-impling" (`hunter:impling-loot`), "random-event" (`random-events:reward`),
 * "nuggets" (`motherlode:nuggets`), "nest" (`woodcutting:nest-search`), "rogues-chest"
 * (`rogues-chest:loot`) and "cache-open" (`phantom-muspah:frozen-cache`). A task naming no source
 * takes any of them (its item is unique to its source, e.g. the Big Harpoonfish).
 */
function obtained(source, { player, itemId, amount }) {
  if (!player) return;
  const id = Number(itemId);
  if (!Number.isInteger(id)) return;
  countSourced(player, "obtain", itemName(id), Number(amount ?? 1) || 1, source);
  checkObtainAll(player, id);
}

/** As `count`, but for a trigger that names a source, only the tasks wanting that source (or none). */
function countSourced(player, kind, name, amount, source) {
  const type = Common.leagueOf(player);
  if (type === null || !(amount > 0)) return;
  const tasks = (indexOf(type)[kind].get(key(name)) ?? []).filter((task) => !task.trigger.source || task.trigger.source === source);
  countTasks(player, type, tasks, amount);
}

/** An awarded loot roll (`npc-drops:roll`, source "drop") or the Rogue's Castle chest's loot
 * (`rogues-chest:loot`, source "rogues-chest") for every drop: each one the roll really granted
 * counts, never a potential one. */
function rolled(source, { player, drops }) {
  if (!player || !Array.isArray(drops)) return;
  for (const drop of drops) {
    const itemId = Number(drop?.itemId ?? drop?.id);
    if (!Number.isInteger(itemId)) continue;
    countSourced(player, "obtain", itemName(itemId), Number(drop.amount ?? 1) || 1, source);
    checkObtainAll(player, itemId);
  }
}

/** A bird's nest searched (`woodcutting:nest-search`): the seed taken out, credited to the "nest"
 * source and, for the High level seed task, the `nest-seed` kind. */
function nestSearch(event) {
  obtained("nest", { player: event.player, itemId: event.itemId, amount: 1 });
  onEvent("nest-seed")(event);
}

/** An impling's loot (`hunter:impling-loot`): each reward, with the Crystal impling its own source. */
function implingLoot({ player, impling, rewards }) {
  if (!player || !Array.isArray(rewards)) return;
  const source = String(impling ?? "").toUpperCase() === "CRYSTAL" ? "crystal-impling" : "impling";
  for (const [itemId, amount] of rewards) obtained(source, { player, itemId, amount });
}

/** `motherlode-nuggets { count }`: golden nuggets taken from the sack, `motherlode:nuggets` { amount }. */
function nuggets({ player, amount }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  countTasks(player, type, indexOf(type).events.get("motherlode-nuggets") ?? [], Number(amount ?? 1) || 1);
}

/** `haircut { count }`: a makeover of the hair type, `makeover:applied` { player, type }. */
function haircut({ player, type }) {
  if (!player || Number(type) !== 0) return; // TYPE_HAIR
  const league = Common.leagueOf(player);
  if (league === null) return;
  countTasks(player, league, indexOf(league).events.get("haircut") ?? []);
}

/** `agility-tickets { count }`: Brimhaven Agility Arena tags, `minigame:points`
 * { player, minigame: "brimhaven-agility-arena", points } (a doubled tag counts twice). */
function agilityTickets({ player, minigame, points }) {
  if (!player || minigame !== "brimhaven-agility-arena") return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  countTasks(player, type, indexOf(type).events.get("agility-tickets") ?? [], Number(points ?? 1) || 1);
}

/** `agility-ticket-streak { tickets, count }`: a clean run of Brimhaven tags reaches the count,
 * `brimhaven-agility-arena:streak` { player, tickets } (reset by a missed pillar: the cycle ended with no
 * tag, or the player left the arena). */
function agilityTicketStreak({ player, tickets }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const streak = Number(tickets) || 0;
  const tasks = (indexOf(type).events.get("agility-ticket-streak") ?? []).filter((task) => streak >= Number(task.trigger.tickets));
  countTasks(player, type, tasks);
}

/** `coin-pouch { coins, count }`: a coin pouch opened for at least that many coins at once,
 * `coin-pouch:opened` { player, coins, all, pouches } (Open-all's whole stack, or a single Open). */
function coinPouch({ player, coins, pouches }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const amount = Number(coins) || 0;
  const opened = Number(pouches) || 0;
  // A task with `coins` needs that many paid at once; one with `pouches` ("Open 28 ... at once"), that
  // many opened. Either missing is no floor. Only a completed open emits the event, so a refusal is no deed.
  const tasks = (indexOf(type).events.get("coin-pouch") ?? []).filter((task) => (!(Number(task.trigger.coins) > 0) || amount >= Number(task.trigger.coins))
    && (!(Number(task.trigger.pouches) > 0) || opened >= Number(task.trigger.pouches)));
  countTasks(player, type, tasks);
}

/** `archery-target { points, count }`: a finished Target round scoring at least that many points,
 * `archery-competition:score` { player, score, tickets }. */
function archeryTarget({ player, score }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const points = Number(score) || 0;
  const tasks = (indexOf(type).events.get("archery-target") ?? []).filter((task) => points >= Number(task.trigger.points));
  countTasks(player, type, tasks);
}

/** `miscellania { approval, count }`: a Miscellania collection made at least that approval,
 * `miscellania:collected` { player, approval } (a percentage, 0-100). */
function miscellaniaCollect({ player, approval }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const rating = Number(approval) || 0;
  const tasks = (indexOf(type).events.get("miscellania") ?? []).filter((task) => rating >= Number(task.trigger.approval));
  countTasks(player, type, tasks);
}

/** `colosseum-glory { glory, count }`: a run's Glory at least that much, `colosseum:glory`
 * { player, glory } (each wave's running total; the best is kept by the minigame). */
function colosseumGlory({ player, glory }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const earned = Number(glory) || 0;
  const tasks = (indexOf(type).events.get("colosseum-glory") ?? []).filter((task) => earned >= Number(task.trigger.glory));
  countTasks(player, type, tasks);
}

/** The items obtained over time toward the open `obtain-all` tasks (task id -> { unit index: 1 }). */
function obtainedStoreOf(player) {
  const value = player.getAttribute(OBTAINED_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Each open `obtain-all { items }` task, when one more of its items is obtained ("Obtain every
 * Revenant weapon"): every one of the items gathered, kept across a logout in `league:task-obtained`. */
function checkObtainAll(player, itemId) {
  const type = Common.leagueOf(player);
  if (type === null || !Number.isInteger(itemId)) return;
  const tasks = indexOf(type).obtainAll;
  if (!tasks.length) return;
  const name = key(itemName(itemId));
  if (!name) return;
  const done = new Set(Common.completedIds(player));
  let store = null;
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(player, type, task)) continue;
    const items = task.trigger.items ?? [];
    if (!items.some((unit) => key(unit) === name)) continue;
    store ??= { ...obtainedStoreOf(player) };
    const seen = { ...(store[task.id] && typeof store[task.id] === "object" ? store[task.id] : {}) };
    items.forEach((unit, index) => { if (key(unit) === name) seen[index] = 1; });
    if (items.every((_unit, index) => seen[index] === 1)) { delete store[task.id]; Complete.complete(player, task.id, type); }
    else store[task.id] = seen;
  }
  if (store) player.setAttribute(OBTAINED_ATTRIBUTE, store);
}

/** Kinds counted once per event, a filter on the event's payload (temple-trek's difficulty, pest-control's boat). */
const EVENT_KINDS = new Map([
  ["slayer-tasks", () => true],
  ["superior-kills", () => true],
  ["temple-trek", (trigger, event) => trigger.difficulty === event.difficulty],
  ["pest-control", (trigger, event) => trigger.boats.includes(event.boat)],
  ["pet", (trigger, event) => (trigger.skilling === true ? !!event.skill : !event.skill)],
  ["tempoross", () => true],
  ["open-chest", (trigger, event) => trigger.chests.some((chest) => key(chest) === key(event.chest))],
  ["plant", (trigger, event) => (!trigger.crops || trigger.crops.includes(event.crop)) && (!trigger.patches || trigger.patches.includes(event.patch?.type))],
  ["harvest", (trigger, event) => trigger.crops.includes(event.crop)],
  // A successful sword: a ruined one (quality 0) counts for neither.
  ["plunder-chest", (trigger, event) => Number(event.room) === trigger.room],
  ["sepulchre-floor", (trigger, event) => Number(event.floor) === trigger.floor],
  ["rumours", () => true],
  ["random-event", (trigger, event) => trigger.events.includes(event.event)],
  ["totem", (trigger, event) => trigger.woods.includes(String(event.wood).toLowerCase())],
  ["dummy", () => true],
  ["gather-with", (trigger, event) => trigger.skill === event.gatherSkill
    && trigger.tools.some((tool) => key(tool) === key(itemName(event.toolId)))
    && (!trigger.items || trigger.items.some((each) => key(each) === key(itemName(event.itemId))))],
  ["bird-nest", () => true],
  ["alch", (trigger, event) => Number(event.coins) >= Number(trigger.coins)],
  ["prayer-restore", (trigger, event) => Number(event.restored) >= Number(trigger.amount)],
  ["buy", (trigger, event) => trigger.shops.includes(event.shopName) && trigger.items.some((each) => key(each) === key(itemName(event.itemId)))],
  ["pickpocket-loot", (trigger, event) => trigger.npcs.some((npc) => key(npc) === key(event.target))
    && (event.loot ?? []).some((entry) => trigger.items.some((each) => key(each) === key(itemName(Number(entry?.id ?? entry?.itemId)))))],
  ["take", (trigger, event) => trigger.source === event.source && trigger.items.some((each) => key(each) === key(itemName(event.itemId)))],
  ["emote", (trigger, event) => trigger.slots.includes(Number(event.slot))],
  ["tob", (trigger, event) => trigger.modes.includes(event.mode)],
  ["teleport", (trigger, event) => trigger.spells.includes(String(event.name ?? "").toLowerCase())],
  ["bank", () => true],
  ["shortcut", (trigger, event) => trigger.shortcuts.includes(event.shortcut)],
  ["npc-op", (trigger, event) => trigger.option === String(event.option ?? "").toLowerCase() && trigger.npcs.some((npc) => key(npc) === key(npcName(event.npcId)))],
  // An object's option something answered. The task names the object by cache id and/or name; an
  // `option` it gives must be the one clicked ("open", "fill"); a task naming neither is every one. A
  // task with an `event` is credited only by that content's success event (a chest that really gave its
  // loot, an oven that really fired), never by the click pipeline's `object:operated`.
  ["object-op", (trigger, event) => (trigger.event ?? "object:operated") === (event.source ?? "object:operated")
    && (trigger.option === undefined || trigger.option === String(event.option ?? "").toLowerCase())
    && (!trigger.objectIds || trigger.objectIds.includes(Number(event.objectId)))
    && (!trigger.objects || trigger.objects.some((object) => key(object) === key(objectName(event.objectId))))],
  // An item's own inventory action something answered (Open on a mystery box), by the item's cache
  // id and/or name and the option clicked, one lower-cased ("open", "open-all"); an `amount` the one
  // action must have covered at once ("28 Coin Pouches at once").
  ["item-op", (trigger, event) => (trigger.option === undefined || trigger.option === String(event.option ?? "").toLowerCase())
    && (!trigger.itemIds || trigger.itemIds.includes(Number(event.itemId)))
    && (!trigger.items || trigger.items.some((item) => key(item) === key(itemName(event.itemId))))
    && (!(trigger.amount > 0) || Number(event.amount ?? 1) >= Number(trigger.amount))],
  ["foundry", (trigger, event) => Number(event.quality) > 0 && (!(trigger.quality > 0) || Number(event.quality) >= trigger.quality)],
  // A clean run of Brimhaven Agility Arena tags ("Receive 30 ... without missing any pillars").
  ["agility-ticket-streak", () => true],
  // A haircut ("Go and get a haircut"): the makeover applied to the hair (never a beard).
  ["haircut", () => true],
  // Brimhaven Agility Arena tags ("Receive an Agility Arena Ticket"); summed (see `agilityTickets`).
  ["agility-tickets", () => true],
  // A coin pouch opened for that many coins at once ("Open a stack ... at least 800 Coins").
  ["coin-pouch", () => true],
  // A finished Target round at or above the score ("Achieve 250/750/1000 points").
  ["archery-target", () => true],
  // A Miscellania collection at or above the approval percentage ("with an approval rating of 100%").
  ["miscellania", () => true],
  // A Fortis Colosseum run's Glory at or above the amount ("Obtain 40,000/58,000 Glory").
  ["colosseum-glory", () => true],
  // Golden nuggets from the Motherlode Mine sack (the count is the sum; see `nuggets`).
  ["motherlode-nuggets", () => true],
  // A bird's nest searched, for one of the seeds the task names ("a Magic seed ... from a birds nest").
  ["nest-seed", (trigger, event) => trigger.items.some((each) => key(each) === key(itemName(event.itemId)))],
]);

function onEvent(kind) {
  return (event) => {
    const player = event?.player;
    const type = player ? Common.leagueOf(player) : null;
    if (type === null) return;
    const accepts = EVENT_KINDS.get(kind);
    countTasks(player, type, (indexOf(type).events.get(kind) ?? []).filter((task) => accepts(task.trigger, event)));
  };
}

/**
 * `enter { place }`: the player inside the place (a guild, a dungeon, an island). Each of its boxes is
 * a zone (`onZoneEnter`), so a step, a teleport or a login inside it counts.
 */
function entered(player, place) {
  const type = player ? Common.leagueOf(player) : null;
  if (type === null) return;
  const done = new Set(Common.completedIds(player));
  for (const task of indexOf(type).enter.get(place) ?? []) if (!done.has(task.id)) Complete.complete(player, task.id, type);
}

/**
 * `deed { event, items?, where?, count }`: a content plugin's own event of the deed (`ectofuntus:worshipped`,
 * `runecrafting:pouch-filled`), its `itemId` one of the items if they are named, its other fields the
 * `where` values (`magic:spellbook-changed`'s spellbook "lunar").
 */
function didDeed(name, event) {
  const player = event?.player;
  const type = player ? Common.leagueOf(player) : null;
  if (type === null) return;
  const tasks = (indexOf(type).deeds.get(name) ?? []).filter((task) => (!task.trigger.items || task.trigger.items.some((each) => key(each) === key(itemName(event.itemId))))
    && Object.entries(task.trigger.where ?? {}).every(([field, value]) => (Array.isArray(value) ? value : [value]).some((each) => String(event[field]).toLowerCase() === String(each).toLowerCase())));
  countTasks(player, type, tasks);
}

/** The events some league's deed task names, each listened to. */
function watchDeeds(api) {
  const named = new Set();
  for (const type of Common.types()) for (const task of Common.catalog(type).tasks) if (task.trigger?.kind === "deed") named.add(task.trigger.event);
  for (const name of named) api.onCustomEvent(name, (event) => didDeed(name, event));
}

/** The places some league's enter task names: each box of each a zone. */
function watchPlaces(api) {
  const named = new Set();
  for (const type of Common.types()) for (const task of Common.catalog(type).tasks) if (task.trigger?.kind === "enter") named.add(task.trigger.place);
  for (const place of named) {
    for (const [minX, minY, maxX, maxY] of Common.places[place]?.rects ?? []) api.onZoneEnter({ minX, maxX, minY, maxY }, ({ player }) => entered(player, place));
  }
}

/** `rifts { count }`: Guardians of the Rift's own count of rifts closed (`rifts`) reaches the count. */
function riftClosed({ player, rifts }) {
  const type = player ? Common.leagueOf(player) : null;
  if (type === null) return;
  for (const task of indexOf(type).rifts) if (Number(rifts) >= Number(task.trigger.count)) Complete.complete(player, task.id, type);
}

function prayed({ player, prayerId }) {
  const name = Common.core.PrayerData?.prayerData?.get?.(prayerId)?.name;
  if (player && name) count(player, "prayer", name);
}

function lapped({ player, course, count: laps }) {
  if (player) count(player, "laps", course, Number(laps ?? 1) || 1);
}

function login({ player, league }) {
  if (!Common.catalog(league)) return;
  checkWorn(player);
  checkCollectionLog(player, league);
}

module.exports = function attach(api) {
  api.persistAttribute(PROGRESS_ATTRIBUTE, {});
  api.persistAttribute(WORN_ATTRIBUTE, {});
  api.persistAttribute(OBTAINED_ATTRIBUTE, {});
  api.onCustomEvent("equipment:changed", equipmentChanged);
  // Worn in an area: also as the player crosses into a map square there (league areas are squares).
  api.onPlayerMapSquareChange?.(({ player }) => player && checkWorn(player));
  api.onCustomEvent("skills:produced", produced);
  api.onCustomEvent("fishing:success", gathered);
  api.onCustomEvent("woodcutting:success", chopped);
  api.onCustomEvent("mining:success", gathered);
  api.onCustomEvent("runecrafting:success", crafted);
  api.onCustomEvent("hunter:success", hunted);
  api.onCustomEvent("thieving:success", stole);
  api.onCustomEvent("treasure-trails:casket-opened", casket);
  api.onCustomEvent("agility:lap", lapped);
  api.onCustomEvent("food:eaten", ate);
  api.onCustomEvent("prayer:activated", prayed);
  api.onCustomEvent("slayer:task-completed", onEvent("slayer-tasks"));
  api.onCustomEvent("slayer:superior-killed", onEvent("superior-kills"));
  api.onCustomEvent("temple-trekking:completed", onEvent("temple-trek"));
  api.onCustomEvent("pest-control:won", onEvent("pest-control"));
  api.onCustomEvent("pets:obtained", onEvent("pet"));
  api.onCustomEvent("tempoross:subdued", onEvent("tempoross"));
  api.onCustomEvent("chests:opened", onEvent("open-chest"));
  api.onCustomEvent("farming:planted", onEvent("plant"));
  api.onCustomEvent("farming:harvest", onEvent("harvest"));
  api.onCustomEvent("giants-foundry:sword-handed-in", onEvent("foundry"));
  api.onCustomEvent("pyramid-plunder:chest-searched", onEvent("plunder-chest"));
  api.onCustomEvent("hallowed-sepulchre:floor-completed", onEvent("sepulchre-floor"));
  api.onCustomEvent("hunter:rumour-completed", onEvent("rumours"));
  api.onCustomEvent("random-events:completed", onEvent("random-event"));
  api.onCustomEvent("vale-totems:decorated", onEvent("totem"));
  api.onCustomEvent("dummies:hit", onEvent("dummy"));
  api.onCustomEvent("spell:teleport-arrival", onEvent("teleport"));
  api.onCustomEvent("guardians-of-the-rift:rift-closed", riftClosed);
  api.onCustomEvent("tob:completed", onEvent("tob"));
  api.onCustomEvent("player:emote", onEvent("emote"));
  api.onCustomEvent("ground-items:taken", onEvent("take"));
  api.onCustomEvent("thieving:loot", onEvent("pickpocket-loot"));
  api.onCustomEvent("woodcutting:nest-drop", onEvent("bird-nest"));
  api.onCustomEvent("shop:purchase", onEvent("buy"));
  api.onCustomEvent("magic:alchemy-completed", onEvent("alch"));
  api.onCustomEvent("altars:prayed", onEvent("prayer-restore"));
  api.onCustomEvent("bank:opened", onEvent("bank"));
  api.onCustomEvent("npc:operated", onEvent("npc-op"));
  api.onCustomEvent("object:operated", onEvent("object-op"));
  api.onCustomEvent("item:operated", onEvent("item-op"));
  // A loc's own success events: a chest that gave its loot, an oven that fired (see the `object-op` accepts).
  // They carry their own `source` so a task waiting on the click pipeline is not credited by them, and vice versa.
  api.onCustomEvent("chest:opened", (event) => onEvent("object-op")({ ...event, source: "chest:opened", option: "open" }));
  api.onCustomEvent("pottery:fired", (event) => onEvent("object-op")({ ...event, source: "pottery:fired", option: "fire" }));
  api.onCustomEvent("agility:obstacle", onEvent("shortcut"));
  // Gathered with a tool: the logs or ore and the axe or pickaxe the success events carry.
  const gatheredWith = onEvent("gather-with");
  api.onCustomEvent("woodcutting:success", (event) => gatheredWith({ ...event, gatherSkill: "woodcutting", toolId: event.axeId, itemId: event.logId }));
  api.onCustomEvent("mining:success", (event) => gatheredWith({ ...event, gatherSkill: "mining", toolId: event.pickaxeId }));
  api.onCustomEvent("farming:check-health", checkedHealth);
  api.onCustomEvent("collection-log:slot-filled", logged);

  api.onCustomEvent("world:picked", picked);
  api.onCustomEvent("magic:cast-committed", cast);
  api.onCustomEvent("magic:item-spell-cast", cast);
  api.onCustomEvent("firemaking:success", burnt);
  api.onCustomEvent("cooking:burnt", burntFood);
  api.onCustomEvent("prayer:buried", buried);
  api.onCustomEvent("potions:drunk", drank);
  api.onCustomEvent("league:login", login);
  // Obtain: each source event, told apart so a deed is only ever credited from the right one.
  api.onCustomEvent("collection-log:obtain", (event) => obtained("logged", event));
  api.onCustomEvent("npc-drops:roll", (event) => rolled("drop", event));
  api.onCustomEvent("rogues-chest:loot", (event) => rolled("rogues-chest", event));
  api.onCustomEvent("mining:gem", (event) => obtained("mining", { player: event.player, itemId: event.itemId, amount: 1 }));
  // A gem rock's own find is a plain mining:success, so its gem counts here too ("Obtain a Gem While Mining").
  api.onCustomEvent("mining:success", (event) => obtained("mining", { player: event.player, itemId: event.itemId, amount: 1 }));
  api.onCustomEvent("mining:geode", (event) => obtained("geode", { player: event.player, itemId: event.itemId, amount: 1 }));
  api.onCustomEvent("fishing:junk", (event) => obtained("fishing", { player: event.player, itemId: event.itemId, amount: Number(event.amount ?? 1) || 1 }));
  api.onCustomEvent("hunter:impling-loot", implingLoot);
  api.onCustomEvent("random-events:reward", (event) => obtained("random-event", { player: event.player, itemId: event.itemId, amount: Number(event.amount ?? 1) || 1 }));
  api.onCustomEvent("phantom-muspah:frozen-cache", (event) => obtained("cache-open", { player: event.player, itemId: event.itemId, amount: 1 }));
  api.onCustomEvent("woodcutting:nest-search", nestSearch);
  api.onCustomEvent("motherlode:nuggets", nuggets);
  api.onCustomEvent("makeover:applied", haircut);
  api.onCustomEvent("minigame:points", agilityTickets);
  api.onCustomEvent("brimhaven-agility-arena:streak", agilityTicketStreak);
  api.onCustomEvent("coin-pouch:opened", coinPouch);
  api.onCustomEvent("archery-competition:score", archeryTarget);
  api.onCustomEvent("miscellania:collected", miscellaniaCollect);
  api.onCustomEvent("colosseum:glory", colosseumGlory);
  watchPlaces(api);
  watchDeeds(api);
};

module.exports.PROGRESS_ATTRIBUTE = PROGRESS_ATTRIBUTE;

// Shipwreck salvaging: a boat's salvaging hook (Deploy) reels salvage in from a raised wreck
// nearby for Sailing XP, and a salvaging station (on a boat or at a port) sorts it into loot
// for more. Messages, animations, sounds and the timings of casting and sorting are from live
// captures; levels, XP, success charts and loot tables from the OSRS Wiki, via
// sailing-salvage.json (docs/sailing-osrs-reference.md).
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { content, setVarbit, playSound, spam, animateDeckLoc } = require("./SailingContent.Sailing");
const facilities = require("./BoatFacilities.Sailing");
const shipwrecks = require("./Shipwrecks.Salvaging");

let pluginApi = null;

/**
 * A hook's animations by its model's size, from the loc's own idle animation (cache): the raft's
 * 1x3 hooks (13565), the skiff's 2x5 (13572) and the sloop's 3x8 ones (13579, its other hooks are
 * 2x5). Each size's animations follow its idle in the same order; the crew's cast is its own
 * (rsprox: 1180 and 1181 on a sloop's two hooks).
 */
const HOOK_ANIMS = new Map([
  [13565, { crewDrop: 1179 }],
  [13572, { crewDrop: 1180 }],
  [13579, { crewDrop: 1181 }],
]);
const DEFAULT_HOOK_IDLE = 13572;
const SEQ_SORT = 13599;
/**
 * Each sort, the first included, plays one of three sounds; a find plays 10860 (rsprox captures,
 * rev 235: 400 begins and 1639 finds, the three about equally often).
 */
const SOUNDS_SORT = [10864, 10865, 10866];
const SOUND_SORTED = 10860;
/** `sailing_sidepanel_player_at_facility_n`: 19193 + n for hotspots 0-10 (19200 is 7, as captured). */
const VARBIT_AT_FACILITY0 = 19193;
const AT_FACILITY_HOTSPOTS = 11;
/** How far (tiles) from the hook a wreck can be: about 8 in OSRS, as played. */
const HOOK_RANGE = 8;
/** Ticks from the cast until the hook settles, and until its first roll (captured: settled at 3, salvage at 10). */
const SETTLE_TICKS = 3;
const FIRST_ROLL_TICKS = 6;
/** Players roll every 4 ticks (OSRS Wiki). */
const ROLL_TICKS = 4;
/** Sorting takes 3 ticks a salvage (captured). */
const SORT_TICKS = 3;

const NO_WRECK = "There are no shipwrecks within range of the salvaging hook.";
const CAST = "You cast out your salvaging hook towards the shipwreck...";
const REELED = "You reel in some salvage.";
const SUNK = "You salvage all you can from the shipwreck before it is reclaimed by the sea.";
const SORT_BEGIN = "You begin sorting through your salvage...";
/** A message box (rsprox). */
const NOTHING_TO_SORT = "You do not have any salvage to sort through.";
/** Sent on the tick the last salvage is sorted. */
const NO_MORE_TO_SORT = "You have no more salvage to sort.";
/**
 * Sorting stops with this once only salvage above the player's level is left (Wiki, Opulent
 * salvage#Trivia). Ours: it is also the refusal when no salvage can be sorted at all.
 */
const LEVEL_TOO_LOW = "You do not have a high enough Sailing level to sort through any more salvage.";
/** Clue chances are 5% better with the tier's combat achievements (Wiki, each salvage's page). */
const CLUE_TIERS = {
  beginner: { scroll: "CLUE_SCROLL_BEGINNER_", achievements: false },
  easy: { scroll: "CLUE_SCROLL_EASY_", achievements: true },
  medium: { scroll: "CLUE_SCROLL_MEDIUM_", achievements: true },
  hard: { scroll: "CLUE_SCROLL_HARD_", achievements: true },
};

/** Per player: what they're doing (salvaging or sorting), so a new action replaces the old. */
const sessions = new Map();

function salvageData() {
  return content().salvage;
}

/** A hook's tier (0 bronze … 6 dragon) from its name, or -1. */
function hookTierOf(name) {
  const match = /^(\w+) salvaging hook$/.exec(name ?? "");
  return match ? salvageData().hookTiers.indexOf(match[1]) : -1;
}

/** The standard OSRS skilling chance: `low` at level 1 to `high` at 99, out of 256. */
function successChance(low, high, level) {
  const clamped = Math.max(1, Math.min(99, level));
  return (1 + Math.floor((low * (99 - clamped)) / 98 + (high * (clamped - 1)) / 98 + 0.5)) / 256;
}

/** A hook loc's animations: the loc's cast/idle/reset and the human's (player or crewmate). */
function hookAnims(locId) {
  const idle = CacheDefinitions.getObject(locId)?.seqId;
  const base = HOOK_ANIMS.has(idle) ? idle : DEFAULT_HOOK_IDLE;
  return {
    locDrop: base + 1,
    locIdle: base + 2,
    locReset: base + 3,
    drop: base + 4,
    idle: base + 5,
    reset: base + 6,
    crewDrop: HOOK_ANIMS.get(base).crewDrop,
  };
}

function hasFreeSlot(player) {
  return player.getInventory().getFreeSlots() > 0;
}

function messageBox(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** A message box naming the salvage: "...hold any more barracuda salvage." (rsprox captures). */
function inventoryFull(player, type) {
  messageBox(player, `Your inventory is too full to hold any more ${type.salvageName.toLowerCase()}.`);
}

function stop(player) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  session.task.stop();
  if (session.hotspot !== undefined) setVarbit(player, VARBIT_AT_FACILITY0 + session.hotspot, 0);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
}

function begin(player, session, tick) {
  stop(player);
  session.task = new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (sessions.get(player) !== session) return this.stop();
      tick(this);
    }
  })();
  sessions.set(player, session);
  TaskManager.submit(session.task);
}

function moved(player) {
  return player.getMovementQueue().size() > 0 || !player.isRegistered?.() || player.getHitpoints?.() <= 0;
}

/** Where a hook on a deck is in the world. */
function hookTile(boat, hook) {
  const tile = boat.deckTileToWorld(boat.deckBaseX + hook.x, boat.deckBaseY + hook.y);
  return { x: tile.x, y: tile.y, level: boat.level };
}

/**
 * Where a player faces to work a hook: out over its side of the boat (a west hotspot faces
 * west, an east one east), or the hook itself when its side isn't known.
 */
function outwardFrom(boat, hook, owned, hotspot) {
  const side = owned && hotspot !== undefined ? facilities.hotspotsOf(owned.type)[hotspot]?.side : undefined;
  const dx = side === 1 ? -1 : side === 3 ? 1 : 0;
  return new Location(boat.deckBaseX + hook.x + dx, boat.deckBaseY + hook.y, 0);
}

/** A salvaging hook's Deploy: cast it towards the nearest raised wreck in range. */
function deployHook(event) {
  if (event.clickType !== 1 || event.definition?.getInteractions?.()?.[0] !== "Deploy") return;
  const tier = hookTierOf(event.definition.getName?.());
  const { player } = event;
  const boat = tier >= 0 ? BoatManager.getBoatAboard(player) : undefined;
  if (!boat) return;
  event.handled = true;
  const x = event.location.x - boat.deckBaseX;
  const y = event.location.y - boat.deckBaseY;
  const hook = BoatManager.getSpec(boat)?.locs.find((loc) => loc.x === x && loc.y === y && loc.shape === 10);
  if (!hook) return;
  const at = hookTile(boat, hook);
  const wreck = shipwrecks.raisedWreckNear(at.x, at.y, at.level, HOOK_RANGE);
  if (!wreck) {
    player.sendMessage(NO_WRECK);
    return;
  }
  const type = shipwrecks.wreckType(wreck.type);
  if (player.getSkillManager().getCurrentLevel(Skill.SAILING) < type.level) {
    player.sendMessage(`You need a Sailing level of at least ${type.level} to salvage this shipwreck.`);
    return;
  }
  if (!hasFreeSlot(player)) {
    inventoryFull(player, type);
    return;
  }
  const owned = Sailing.instanceAboard(player) === boat ? Sailing.activeBoat(player) : undefined;
  const hotspot = owned ? facilities.hotspotAt(owned, x, y) : undefined;
  const anims = hookAnims(hook.id);
  const session = {
    boat, hook, wreck, tier, anims, generation: wreck.generation, ticks: 0,
    hotspot: hotspot !== undefined && hotspot < AT_FACILITY_HOTSPOTS ? hotspot : undefined,
  };
  // A crewmate working this hook leaves it to the captain (rsprox).
  if (hotspot !== undefined) pluginApi?.emitCustomEvent("sailing:hook-taken", { player, boat, hotspot });
  player.sendMessage(CAST);
  player.setPositionToFace(outwardFrom(boat, hook, owned, hotspot));
  player.performAnimation(new Animation(anims.drop));
  animateDeckLoc(player, boat, hook, anims.locDrop);
  shipwrecks.startDespawn(wreck);
  begin(player, session, () => salvageTick(player, session));
}

function salvageTick(player, session) {
  const { boat, hook, wreck } = session;
  if (moved(player) || BoatManager.getBoatAboard(player) !== boat) return stop(player);
  if (wreck.generation !== session.generation) {
    player.sendMessage(SUNK);
    return stop(player);
  }
  const at = hookTile(boat, hook);
  if (shipwrecks.distanceTo(wreck, at.x, at.y) > HOOK_RANGE || wreck.z !== at.level) return stop(player);
  session.ticks++;
  if (session.ticks === SETTLE_TICKS && session.hotspot !== undefined) {
    setVarbit(player, VARBIT_AT_FACILITY0 + session.hotspot, 1);
  }
  if (session.ticks >= SETTLE_TICKS) {
    player.performAnimation(new Animation(session.anims.idle));
    animateDeckLoc(player, boat, hook, session.anims.locIdle);
  }
  if (session.ticks < FIRST_ROLL_TICKS || (session.ticks - FIRST_ROLL_TICKS) % ROLL_TICKS !== 0) return;
  const type = shipwrecks.wreckType(wreck.type);
  const [low, high] = type.success[session.tier];
  if (Math.random() >= successChance(low, high, player.getSkillManager().getCurrentLevel(Skill.SAILING))) return;
  if (!hasFreeSlot(player)) {
    inventoryFull(player, type);
    return stop(player);
  }
  player.getInventory().addItem(new Item(type.salvage, 1));
  player.sendMessage(REELED);
  player.getSkillManager().addExperiences(Skill.SAILING, type.xp);
  if (type.petChance) {
    // Soup's chance is per wreck type, not level-scaled (Wiki, Soup#Drop rates).
    pluginApi?.emitCustomEvent("sailing:success", { player, skill: Skill.SAILING, petChance: type.petChance });
  }
}

/**
 * Rolls a salvage's loot: its pre-rolls first, then its main table; undefined is nothing. A
 * shared-table line comes back as { table, empty } for rollShared. `owns(ids)` says whether the
 * player owns any of a pre-roll's `unlessOwned` items, which skips that pre-roll. A pre-roll clue
 * (one in `clueOneIn`, 0 for none) is rolled first and comes back as { clue: true }. A find the
 * salvage's collection log holds comes back with `collectionLog: true`.
 */
function rollLoot(salvage, random = Math.random, owns = () => false, clueOneIn = 0) {
  const find = (line) => {
    const loot = { item: line.item, amount: line.min + Math.floor(random() * (line.max - line.min + 1)) };
    if (line.collectionLog) loot.collectionLog = true;
    return loot;
  };
  if (clueOneIn > 0 && random() * clueOneIn < 1) return { clue: true };
  for (const line of salvage.preRolls) {
    if (line.unlessOwned && owns(line.unlessOwned)) continue;
    if (random() < 1 / line.oneIn) return find(line);
  }
  let roll = Math.floor(random() * salvage.total);
  for (const line of salvage.table) {
    if (roll < line.weight) return line.table ? { table: line.table, empty: line.empty } : find(line);
    roll -= line.weight;
  }
  return undefined;
}

/**
 * One roll of a shared drop table (NpcDrops); its empty slot gives `empty`, if any. A ring of
 * wealth doesn't change it: the salvage variants have no "nothing" slot for the ring to remove.
 */
function rollShared(player, loot) {
  const request = { player, table: loot.table, drops: [], ringOfWealth: false };
  pluginApi?.emitCustomEvent("npc-drops:roll-shared", request);
  const [drop] = request.drops;
  if (drop) return { item: drop.itemId, amount: drop.amount };
  return loot.empty ? { item: loot.empty.item, amount: loot.empty.amount } : undefined;
}

/** Whether the player has any of `ids` carried, worn or banked. */
function ownsAny(player, ids) {
  const containers = [player.getInventory(), player.getEquipment?.(), ...(player.getBanks?.() ?? [])];
  return ids.some((id) => containers.some((container) => container?.getAmount?.(id) > 0));
}

/** A salvage clue's chance, one in this: 95% of it with the tier's combat achievements; 0 for none. */
function clueOneIn(player, clue) {
  const tier = CLUE_TIERS[clue?.tier];
  if (!tier) return 0;
  if (!tier.achievements) return clue.oneIn;
  const achievement = { player, tier: clue.tier, currentThresholdMet: false };
  pluginApi?.emitCustomEvent("combat-achievements:tier", achievement);
  return achievement.currentThresholdMet === true ? Math.floor((clue.oneIn * 95) / 100) : clue.oneIn;
}

/** Whether the player can hold another clue of the tier (one per tier unless a scroll case allows more). */
function canReceiveClue(player, clue) {
  const allowed = { player, tier: clue.tier, allowed: null };
  pluginApi?.emitCustomEvent("treasure-trails:can-receive", allowed);
  return allowed.allowed === true;
}

/** The clue item to give: the tier's scroll, or its scroll box after X Marks the Spot. */
function clueItem(player, clue) {
  const award = { player, itemId: pluginApi.core.ItemIdentifiers[CLUE_TIERS[clue.tier].scroll], box: false };
  pluginApi.emitCustomEvent("treasure-trails:clue-item", award);
  return award.itemId;
}

/**
 * A salvage's tertiary clue, through the shared clue services. Ours: it goes into the inventory,
 * or under the player when full, with no line of its own.
 */
function rollClue(player, clue, random = Math.random) {
  const oneIn = clueOneIn(player, clue);
  if (oneIn <= 0 || random() * oneIn >= 1) return;
  if (!canReceiveClue(player, clue)) {
    pluginApi?.emitCustomEvent("treasure-trails:missed-clue", { player, tier: clue.tier });
    return;
  }
  player.getInventory().forceAdd(player, new Item(clueItem(player, clue), 1));
}

/**
 * The first salvage in the inventory the player has the level to sort, with its sorting data;
 * `{ tooLow: true }` when all of it is above their level, undefined when there is none. Ours:
 * salvage above the level is passed over for the next kind, in the data's order.
 */
function nextSalvage(player) {
  const table = salvageData().salvage;
  const inventory = player.getInventory();
  const level = player.getSkillManager().getCurrentLevel(Skill.SAILING);
  let tooLow;
  for (const id of Object.keys(table)) {
    if (inventory.getAmount(Number(id)) <= 0) continue;
    if (level >= table[id].level) return { id: Number(id), data: table[id] };
    tooLow = { tooLow: true };
  }
  return tooLow;
}

/** "You sort through the opulent salvage and find: 3,504 x Coins." (rsprox captures). */
function findLine(salvageName, loot) {
  if (!loot) return `You sort through the ${salvageName} and find nothing.`;
  const itemName = CacheDefinitions.getItem(loot.item)?.name ?? "something";
  return `You sort through the ${salvageName} and find: ${Number(loot.amount).toLocaleString("en-US")} x ${itemName}.`;
}

/** A salvaging station's Sort-salvage: sorts every salvage in the inventory, one each 3 ticks. */
function sortSalvage({ player }) {
  const next = nextSalvage(player);
  if (!next) {
    messageBox(player, NOTHING_TO_SORT);
    return;
  }
  if (next.tooLow) {
    player.sendMessage(LEVEL_TOO_LOW);
    return;
  }
  player.sendMessage(SORT_BEGIN);
  player.performAnimation(new Animation(SEQ_SORT));
  playSortSound(player);
  const session = { ticks: 0 };
  begin(player, session, () => sortTick(player, session));
}

function sortTick(player, session) {
  if (moved(player)) return stop(player);
  session.ticks++;
  if (session.ticks % SORT_TICKS !== 0) return;
  const next = nextSalvage(player);
  if (!next) return stop(player);
  if (next.tooLow) {
    player.sendMessage(LEVEL_TOO_LOW);
    return stop(player);
  }
  player.getInventory().delete(next.id, 1);
  // A pre-roll clue replaces the sort's loot; it isn't rolled while the player can't hold one.
  const clue = next.data.clue;
  const preRollClue = clue?.preRoll && canReceiveClue(player, clue) ? clueOneIn(player, clue) : 0;
  let loot = rollLoot(next.data, Math.random, (ids) => ownsAny(player, ids), preRollClue);
  if (loot?.clue) loot = { item: clueItem(player, clue), amount: 1 };
  if (loot?.table) loot = rollShared(player, loot);
  const salvageName = next.data.name.toLowerCase();
  if (loot) {
    const inventory = player.getInventory();
    const before = inventory.getAmount(loot.item);
    inventory.addItem(new Item(loot.item, loot.amount));
    const credited = Math.max(0, inventory.getAmount(loot.item) - before);
    if (credited > 0) pluginApi.emitCustomEvent("collection-log:obtain", { player, itemId: loot.item, amount: credited });
  }
  // A collection log find is a game message; every other find, and nothing, is spam (rsprox captures).
  if (loot?.collectionLog) player.sendMessage(findLine(salvageName, loot));
  else spam(player, findLine(salvageName, loot));
  player.getSkillManager().addExperiences(Skill.SAILING, next.data.xp);
  if (!clue?.preRoll) rollClue(player, clue);
  // Soup can also come from sorting, at one chance for every salvage (Wiki, Soup).
  pluginApi?.emitCustomEvent("sailing:success", { player, skill: Skill.SAILING, petChance: salvageData().sortPetChance });
  playSound(player, SOUND_SORTED);
  const after = nextSalvage(player);
  if (!after) {
    player.sendMessage(NO_MORE_TO_SORT);
    return stop(player);
  }
  if (after.tooLow) {
    player.sendMessage(LEVEL_TOO_LOW);
    return stop(player);
  }
  player.performAnimation(new Animation(SEQ_SORT));
  playSortSound(player);
}

function playSortSound(player) {
  playSound(player, SOUNDS_SORT[Math.floor(Math.random() * SOUNDS_SORT.length)]);
}

function startShipwrecks() {
  shipwrecks.start();
}

function forgetSession({ player }) {
  stop(player);
}

module.exports = {
  hookTierOf,
  successChance,
  rollLoot,
  rollClue,
  outwardFrom,
  hookTile,
  hookAnims,
  HOOK_RANGE,
  register(api) {
    pluginApi = api;
    api.onServerStartup(startShipwrecks);
    api.onObjectInteraction(deployHook);
    api.onObjectInteraction("Salvaging station", { "Sort-salvage": sortSalvage });
    api.onPlayerLogout(forgetSession);
  },
};

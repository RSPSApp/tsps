/** Creature Creation, the solo post-quest activity in the Tower of Life dungeon. */
const QUEST_KEY = "tower_of_life";
const DUNGEON = { minX: 3008, maxX: 3071, minY: 4352, maxY: 4415, z: 0 };
const ALTAR_ATTRIBUTE = {
  newtroost: "creature-creation:newtroost",
  unicow: "creature-creation:unicow",
  swordchick: "creature-creation:swordchick",
  spidine: "creature-creation:spidine",
  frogeel: "creature-creation:frogeel",
  jubster: "creature-creation:jubster",
};
const ALTAR_SECOND_ATTRIBUTE = {
  newtroost: "creature-creation:newtroost-second",
  unicow: "creature-creation:unicow-second",
  swordchick: "creature-creation:swordchick-second",
  spidine: "creature-creation:spidine-second",
  frogeel: "creature-creation:frogeel-second",
  jubster: "creature-creation:jubster-second",
};
const ALTARS = require("./data/creature-creation.json");
// shortcut: one live creature per player per altar, upgrade when an OSRS capture confirms whether multiple same-altar creatures can coexist.
// NPCs are scoped to an owner and altar. A player can have one living creature at each altar.
const ownedNpcs = new Map();
const activityNpcs = new WeakSet();
const ownerByNpc = new WeakMap();
const altarByNpc = new WeakMap();
const activeByAltar = new WeakMap();
const busyPlayers = new WeakSet();

function attribute(altar) { return ALTAR_ATTRIBUTE[altar.key]; }
function secondAttribute(altar) { return ALTAR_SECOND_ATTRIBUTE[altar.key]; }

function atAltar(core, objectId, location) {
  const ids = core.ObjectIdentifiers;
  if ((objectId !== ids.SYMBOL_OF_LIFE && objectId !== ids.SYMBOL_OF_LIFE_2) || location?.z !== DUNGEON.z) return null;
  return ALTARS.find((altar) => altar.tile === `${location.x},${location.y}`) ?? null;
}

function ingredientIds(core, altar) { return altar.ingredients.map((name) => core.ItemIdentifiers[name]); }
function npcId(core, altar) { return core.NpcIdentifiers[altar.npc]; }

function notedIngredientIds(easy, medium) {
  return [
    ...(easy || medium ? ["RAW_JUBBLY", "RAW_CAVE_EEL"] : []),
    ...(medium ? ["EYE_OF_NEWT", "UNICORN_HORN", "RED_SPIDERS_EGGS"] : []),
  ];
}

function ingredientSlot(ingredients, first, second, itemId) {
  if (!ingredients.includes(itemId) || second || first === itemId) return -1;
  return first ? 1 : 0;
}

function isPrimed(ingredients, first, second) {
  return ingredients.includes(first) && ingredients.includes(second) && first !== second;
}

function inDungeon(location) {
  return location && location.getZ() === DUNGEON.z
    && location.getX() >= DUNGEON.minX && location.getX() <= DUNGEON.maxX
    && location.getY() >= DUNGEON.minY && location.getY() <= DUNGEON.maxY;
}

function hasCompletedQuest(api, player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function message(core, player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function putIngredient(api, core, event) {
  const { player, objectId, location, itemId, itemSlot } = event;
  const altar = atAltar(core, objectId, location);
  if (!altar || event.handled) return;
  const ingredients = ingredientIds(core, altar);
  if (!ingredients.includes(itemId)) return;
  const key = attribute(altar);
  const first = Number(player.getAttribute(key)) || 0;
  const second = Number(player.getAttribute(secondAttribute(altar))) || 0;
  const slot = ingredientSlot(ingredients, first, second, itemId);
  if (slot < 0) {
    event.handled = true;
    message(core, player, second ? "The altar already has both ingredients." : "The altar already contains that ingredient.");
    return;
  }
  const inventory = player.getInventory();
  const item = inventory.getItems()[itemSlot];
  if (itemSlot < 0 || item?.getId?.() !== itemId) return;
  if (!inDungeon(player.getLocation())) return;
  event.handled = true;
  if (!hasCompletedQuest(api, player)) {
    message(core, player, "You need to complete the Tower of Life quest first.");
    return;
  }

  const before = inventory.getAmount(itemId);
  inventory.deleteAtSlot(itemSlot, 1);
  if (inventory.getAmount(itemId) !== before - 1) {
    message(core, player, "The ingredient could not be removed from your inventory.");
    return;
  }
  try {
    player.setAttribute(slot ? secondAttribute(altar) : key, itemId);
  } catch (error) {
    inventory.adds(itemId, 1);
    throw error;
  }
  message(core, player, `You place the ${core.ItemDefinition.forId(itemId).getName().toLowerCase()} on the altar.`);
}

function setActive(player, altar, npc) {
  let byAltar = activeByAltar.get(player);
  if (!byAltar) activeByAltar.set(player, byAltar = new Map());
  byAltar.set(altar.key, npc);
}

function clearActive(player, altarKey, npc) {
  const byAltar = activeByAltar.get(player);
  if (byAltar?.get(altarKey) === npc) byAltar.delete(altarKey);
  if (byAltar?.size === 0) activeByAltar.delete(player);
}

function activate(api, core, { player, objectId, location }) {
  const altar = atAltar(core, objectId, location);
  if (!altar || !inDungeon(player.getLocation())) return false;
  if (!hasCompletedQuest(api, player)) {
    message(core, player, "You need to complete the Tower of Life quest first.");
    return true;
  }
  const key = attribute(altar);
  const first = Number(player.getAttribute(key)) || 0;
  const second = Number(player.getAttribute(secondAttribute(altar))) || 0;
  const ingredients = ingredientIds(core, altar);
  if (!isPrimed(ingredients, first, second)) {
    message(core, player, "The altar needs two different ingredients before it can be activated.");
    return true;
  }
  if (busyPlayers.has(player)) return true;
  const existing = activeByAltar.get(player)?.get(altar.key);
  if (existing && !existing.isRegistered() && !core.World.getAddNPCQueue().includes(existing)) {
    forgetNpc({ npc: existing });
  }
  if (activeByAltar.get(player)?.has(altar.key)) {
    message(core, player, "The creature at this altar must be defeated before another can be created here.");
    return true;
  }

  busyPlayers.add(player);
  player.setAttribute(key, 0);
  player.setAttribute(secondAttribute(altar), 0);
  let npc;
  try {
    const tile = player.getLocation();
    npc = api.spawnNpc({
      id: npcId(core, altar),
      x: tile.getX(),
      y: tile.getY(),
      z: tile.getZ(),
      wanderRadius: 3,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) throw new Error("Creature Creation spawn returned no NPC");
    activityNpcs.add(npc);
    ownerByNpc.set(npc, player);
    altarByNpc.set(npc, altar.key);
    let owned = ownedNpcs.get(player);
    if (!owned) ownedNpcs.set(player, owned = new Set());
    owned.add(npc);
    setActive(player, altar, npc);
    message(core, player, `The altar creates a ${altar.creature}.`);
  } catch (error) {
    if (npc) {
      forgetNpc({ npc });
      api.removeNpc(npc);
    }
    player.setAttribute(key, first);
    player.setAttribute(secondAttribute(altar), second);
    if (error.message !== "Creature Creation spawn returned no NPC") throw error;
  } finally {
    busyPlayers.delete(player);
  }
  return true;
}

function forgetNpc({ npc }) {
  if (!activityNpcs.has(npc)) return;
  const player = ownerByNpc.get(npc);
  const npcs = ownedNpcs.get(player);
  npcs?.delete(npc);
  clearActive(player, altarByNpc.get(npc), npc);
  if (npcs?.size === 0) ownedNpcs.delete(player);
}

function clearCreatures(api, player) {
  const npcs = ownedNpcs.get(player);
  if (!npcs) return;
  for (const npc of [...npcs]) {
    forgetNpc({ npc });
    api.removeNpc(npc);
  }
  ownedNpcs.delete(player);
}

function onPlayerGone(api, { player }) { clearCreatures(api, player); }
function postLeave(api, mobile) { if (mobile.isPlayer()) clearCreatures(api, mobile.getAsPlayer()); }
function onServerShutdown(api) { for (const player of [...ownedNpcs.keys()]) clearCreatures(api, player); }

function onDropRoll(api, core, event) {
  if (!activityNpcs.has(event.npc) || ownerByNpc.get(event.npc) !== event.player) return;
  if (event.npcId === 3603 && altarByNpc.get(event.npc) === "swordchick") {
    api.emitCustomEvent("diary:task", {
      player: event.player,
      diary: "ardougne",
      task: "kill-a-swordchick-in-the-tower-of-life",
    });
  }
  const easy = { player: event.player, diary: "ardougne", tier: "easy", complete: false };
  const medium = { player: event.player, diary: "ardougne", tier: "medium", complete: false };
  api.emitCustomEvent("diary:is-complete", easy);
  api.emitCustomEvent("diary:is-complete", medium);
  const notedIds = new Set(notedIngredientIds(easy.complete, medium.complete).map((name) => core.ItemIdentifiers[name]));
  for (const drop of event.drops ?? []) if (notedIds.has(drop.itemId)) drop.noted = true;
}

function createDungeonArea(api, core) {
  class CreatureCreationDungeon extends core.Area {
    getName() { return "Creature Creation dungeon"; }
    postLeave(mobile) { postLeave(api, mobile); }
  }
  return new CreatureCreationDungeon([
    new core.Boundary(DUNGEON.minX, DUNGEON.maxX, DUNGEON.minY, DUNGEON.maxY, DUNGEON.z),
  ]);
}

function setup(api) {
  for (const altar of ALTARS) {
    api.persistAttribute(attribute(altar), 0);
    api.persistAttribute(secondAttribute(altar), 0);
  }
  api.registerArea(createDungeonArea(api, api.core));
}

module.exports = {
  name: "CreatureCreation",
  members: true,
  _test: {
    ALTARS, ingredientIds, atAltar, inDungeon, notedIngredientIds, ingredientSlot, isPrimed,
    putIngredient, activate, onPlayerGone, onDropRoll, forgetNpc,
  },
  register(pluginApi) {
    pluginApi.onServerStartup(setup.bind(null, pluginApi));
    pluginApi.onItemOnObject(putIngredient.bind(null, pluginApi, pluginApi.core), { noted: false });
    pluginApi.onObjectInteraction("Symbol of life", { Activate: activate.bind(null, pluginApi, pluginApi.core) });
    pluginApi.onNpcDeath(forgetNpc);
    pluginApi.onPlayerLogout(onPlayerGone.bind(null, pluginApi));
    pluginApi.onPlayerDeath(onPlayerGone.bind(null, pluginApi));
    pluginApi.onServerShutdown(onServerShutdown.bind(null, pluginApi));
    pluginApi.onCustomEvent("npc-drops:roll", onDropRoll.bind(null, pluginApi, pluginApi.core));
  },
};

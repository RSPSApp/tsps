/**
 * The bridge event (Wiki, "Puzzle events"; captured on the Ramble): a broken bridge, a zombie
 * that drops a bronze axe, and either dead trees to chop or - more often since the bog was
 * removed - undead lumberjacks climbing out of the river, who drop a plank each (and now and
 * then a piece of the lumberjack outfit). Three logs or planks, with an axe wielded or a hammer
 * carried, mend it; "Cross" takes player and follower over to the success path.
 *
 * Points: 500 for the trees bridge, none for the lumberjacks' (Wiki, "Trek points").
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");

const REPAIR_ANIMATION = 3741;
const REPAIR_SOUND = 1800;
const REPAIR_TICKS = 4;
/** Wiki: the lumberjack bridge comes up more often since the bog went (September 2024). */
const LUMBERJACK_CHANCE = 0.65;
const LUMBERJACK_ALIVE = 2;
const LUMBERJACK_RESPAWN = [15, 22];
const LUMBERJACK_STAGE_TICKS = 3;
const LUMBERJACK_EMERGE = [5965, 5966, 5967, 5968];
/** Once per encounter, a missing outfit piece (Wiki: no duplicates, one per encounter). */
const OUTFIT_CHANCE = 1 / 3;
const LOGS = [1511, 1521, 1519, 6333, 1517, 6332, 1515, 1513, 19669, 10810, 2862, 24691];

const STAGE_TEXT = [
  "The bridge is built out of logs which have been worn down over time. The section before you has rotted away and is impossible to cross in its current state.",
  "The bridge looks a little better now, but it's still not safe enough to walk over. It needs some more work.",
  "The bridge looks a lot better now and is almost complete. It just needs a bit more work.",
];

function bridgeIds(trek) {
  const { locs } = Common.data;
  return trek.direction === "ramble" ? locs.ramble_bridge_beam_fix : locs.templetrek_bridge_fixed;
}

function zombieId(trek, version, stage) {
  const difficulty = (Common.data.routes[trek.route].tier - 1) * 3 + trek.difficulty.index + 1;
  const base = difficulty <= 2 ? 5648 + (difficulty - 1) * 8 : 5665 + (difficulty - 3) * 8;
  return base + (version - 1) * 4 + (stage - 1);
}

function start(trek, room) {
  const { spec } = room;
  room.state = { stage: 0, lumberjacks: Math.random() < LUMBERJACK_CHANCE, alive: new Set(), nextSpawn: trek.tickCount + 2, outfit: false };
  room.points = room.state.lumberjacks ? 0 : Common.data.points.puzzle;
  const { GameObject, ObjectManager } = Common.core;
  for (const tile of spec.trees) {
    const tree = trek.area.getTemplateObject(trek.area.at([tile[0], tile[1], 0]), 10);
    if (!tree) continue;
    if (room.state.lumberjacks) {
      ObjectManager.deregister(tree, true);
    } else {
      // Woodcutting chops what the world's object registry knows; a room's template trees
      // aren't in it, so each is put back as a loc of the room's own.
      ObjectManager.register(new GameObject(tree.getId(), tree.getLocation(), tree.getType(), tree.getFace(), trek.area), true);
    }
  }
  const zombie = trek.spawn(Common.data.npcs.templetrek_zombie, spec.zombie);
  trek.schedule(3, () => zombie?.isRegistered?.() && zombie.getHitpoints() > 0 && zombie.getCombat().attack(trek.player));
  const line = Common.data.dialogue[trek.direction].backTo;
  Common.chat(trek.player, [
    ["npc", trek.follower.id, `Blimey! Looks like we're going to have to go back to ${line}. We can't get over that bridge!`],
    ["player", "Oh, I'm sure we can find a way!"],
  ]);
}

function tick(trek, room) {
  const state = room.state;
  for (const npc of [...state.alive]) {
    if (!npc.isRegistered?.() || npc.getHitpoints() <= 0) {
      state.alive.delete(npc);
      continue;
    }
    if (npc.__emergeStage < 4 && trek.tickCount >= npc.__emergeAt) {
      npc.__emergeStage++;
      npc.setNpcTransformationId(zombieId(trek, npc.__version, npc.__emergeStage));
      npc.performAnimation(new Common.core.Animation(LUMBERJACK_EMERGE[npc.__emergeStage - 1]));
      npc.__emergeAt = trek.tickCount + LUMBERJACK_STAGE_TICKS;
      if (npc.__emergeStage === 4) npc.getCombat().attack(trek.player);
    }
  }
  if (!state.lumberjacks || state.stage >= 3 || state.alive.size >= LUMBERJACK_ALIVE || trek.tickCount < state.nextSpawn) return;
  const version = Math.random() < 0.5 ? 1 : 2;
  const npc = trek.spawn(zombieId(trek, version, 1), Common.randomOf(room.spec.lumberjackSpawns));
  if (!npc) return;
  npc.__version = version;
  npc.__emergeStage = 1;
  npc.__emergeAt = trek.tickCount + LUMBERJACK_STAGE_TICKS;
  npc.__trekLumberjack = true;
  npc.performAnimation(new Common.core.Animation(LUMBERJACK_EMERGE[0]));
  state.alive.add(npc);
  state.nextSpawn = trek.tickCount + Common.randomInt(...LUMBERJACK_RESPAWN);
}

function hasTool(player) {
  const { Equipment, ItemDefinition } = Common.core;
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const axe = weapon > 0 && /\baxe\b/i.test(ItemDefinition.forId(weapon)?.getName?.() ?? "");
  if (axe) return "axe";
  return player.getInventory().contains(Common.data.items.hammer) ? "hammer" : null;
}

function material(player, preferred) {
  const inventory = player.getInventory();
  if (preferred != null && (preferred === Common.data.items.plank || LOGS.includes(preferred)) && inventory.contains(preferred)) return preferred;
  if (inventory.contains(Common.data.items.plank)) return Common.data.items.plank;
  return LOGS.find((id) => inventory.contains(id)) ?? null;
}

function repair(trek, preferred = null) {
  const { player, room } = trek;
  const state = room.state;
  if (state.stage >= 3 || state.repairing) return;
  const tool = hasTool(player);
  if (!tool) {
    Common.statement(player, "You'll either need an axe equipped or a hammer in your inventory to fix the bridge.");
    return;
  }
  const item = material(player, preferred);
  if (item == null) {
    Common.statement(player, "You'll need some logs or a plank to fix the bridge.");
    return;
  }
  const what = item === Common.data.items.plank ? ["beam", "plank"] : ["log", "log"];
  Common.closeChat(player);
  state.repairing = true;
  player.sendMessage(`You place a ${what[0]} down over the shaky wooden support struts.`);
  player.sendMessage(`You carefully use your ${tool} to tap the ${what[1]} into place.`);
  player.performAnimation(new Common.core.Animation(REPAIR_ANIMATION));
  Common.sound(player, REPAIR_SOUND);
  trek.schedule(REPAIR_TICKS, () => {
    state.repairing = false;
    if (!player.getInventory().contains(item)) return;
    player.getInventory().deleteNumber(item, 1);
    const [x, y] = room.spec.bridge;
    trek.setLoc(bridgeIds(trek)[state.stage], [x, y, 0], 22, 1);
    state.stage++;
    if (state.stage >= 3) {
      room.complete = true;
      Common.statement(player, "You've successfully repaired the bridge.");
    }
  });
}

function inspect(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "bridge") return false;
  const { player } = event;
  Common.statement(player, STAGE_TEXT[Math.min(trek.room.state.stage, 2)], () => {
    Common.choose(player, "Attempt to fix the bridge?", [["Yes.", () => repair(trek)], ["No.", () => Common.closeChat(player)]]);
  });
  return true;
}

function useOnBridge(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "bridge") return;
  const ids = [Common.data.locs.templetrek_bridge_broken, ...bridgeIds(trek).slice(0, 2)];
  if (!ids.includes(event.objectId ?? event.object?.getId?.())) return;
  if (event.itemId !== Common.data.items.plank && !LOGS.includes(event.itemId)) return;
  event.handled = true;
  repair(trek, event.itemId);
}

function cross(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "bridge") return false;
  const { player, room } = trek;
  player.sendMessage("You walk across the fixed bridge.");
  player.moveTo(trek.area.at(room.spec.across));
  if (trek.npc?.isRegistered?.()) trek.npc.moveTo(trek.area.at(room.spec.followerAcross));
  return true;
}

function ownsItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id)
    || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(id));
}

/**
/**
 * Undead lumberjacks always leave bones and a plank; an outfit piece the player doesn't own
 * comes at most once a bridge (Wiki).
 */
function lumberjackDrops(event) {
  const { npc, drops, player } = event;
  const trek = npc?.__templeTrek;
  if (!trek || !npc.__trekLumberjack) return;
  // Every kill gives bones and a plank for the bridge (Wiki; captured), whatever the table rolled.
  drops.length = 0;
  drops.push({ itemId: Common.data.items.bones, amount: 1 }, { itemId: Common.data.items.plank, amount: 1 });
  const state = trek.room?.key === "bridge" ? trek.room.state : null;
  if (!state || state.outfit || Math.random() >= OUTFIT_CHANCE) return;
  const outfit = Common.data.items.lumberjack;
  const missing = outfit.filter((id) => !ownsItem(player, id));
  if (!missing.length) return;
  const piece = Common.randomOf(missing);
  state.outfit = true;
  drops.push({ itemId: piece, amount: 1 });
  Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: piece, amount: 1 });
}

function attachBridge(api) {
  Trek.registerEvent("bridge", { room: () => Common.data.rooms.bridge, start, tick });
  api.onObjectInteraction("Broken bridge", { Inspect: inspect });
  api.onObjectInteraction("Partially broken bridge", { Inspect: inspect });
  api.onObjectInteraction("Slightly broken bridge", { Inspect: inspect });
  api.onObjectInteraction("Fixed bridge", { Cross: cross });
  api.onItemOnObject(useOnBridge);
  api.onCustomEvent("npc-drops:roll", lumberjackDrops);
}

module.exports = { attachBridge };

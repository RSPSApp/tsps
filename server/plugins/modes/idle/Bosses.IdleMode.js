/**
 * Idle bosses (plugins/modes/data/idle-mode.json "bosses"). Bosses are fought by idle combat
 * (Combat) like any monster: travelled to (the Bosses tab, which asks for a combat level), the
 * loot banked, the kills recorded. Each kill of one named in `names` also counts for the boss
 * achievements and hiscores (Achievements, Hiscores).
 *
 * The Gemstone Crab (`gemstoneCrab`, plugins/bosses/GemstoneCrab.plugin.js) never dies: it stays
 * about ten minutes, burrows, leaves a shell its top 16 damage dealers may mine for gems, and rises
 * at another of its three mines. For an idle player fighting it, every few ticks:
 *
 * - when it burrows (`gemstone-crab:burrowed`), a player among those who may mine it is credited
 *   with a kill (no pause for attacks that never killed), and mines the shell once;
 * - the gems mined go to the bank, recorded for the offline progress with the combat XP (recorded
 *   every `recordEverySeconds` while fighting, as no kill comes to do it);
 * - with no crab in reach, the character crawls through the nearest cave, which leads to the mine
 *   the crab rises at (`gemstone-crab:location`), and fights it there.
 */
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");
const Combat = require("./Combat.IdleMode");
const Achievements = require("./Achievements.IdleMode");

/** player -> { mayMine: whether they may mine the shell left, mined: the shells they have, recordedAt }. */
const states = new Map();

function config() {
  return Common.data.bosses;
}

function crab() {
  return config().gemstoneCrab;
}

function stateOf(player) {
  let state = states.get(player);
  if (!state) states.set(player, (state = { mayMine: false, mined: new WeakSet(), recordedAt: 0 }));
  return state;
}

const plain = (name) => String(name ?? "").replace(/<[^>]+>/g, "");
const npcName = (npc) => plain(npc?.getDefinition?.()?.getName?.());

/** Whether the NPC is one of the bosses (`names`). */
function isBoss(npc) {
  return config().names.includes(npcName(npc));
}

function fightingCrab(player) {
  return Common.isIdle(player) && player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE)?.name === crab().crab;
}

/** `gemstone-crab:burrowed`: a kill for the idle players who may mine its shell. */
function burrowed({ top }) {
  const names = new Set((top ?? []).map((name) => String(name).toLowerCase()));
  for (const player of Combat.tracked) {
    if (!player || !fightingCrab(player) || !names.has(String(player.getUsername?.()).toLowerCase())) continue;
    stateOf(player).mayMine = true;
    Combat.credit(player);
    Achievements.add(player, { kills: 1, bosses: 1 });
  }
}

function nearest(player, radius, matches) {
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const npc of Common.core.World.getNpcsNear(here, radius)) {
    if (npc.isRegistered?.() === false || !matches(npc)) continue;
    const distance = Common.chebyshev(here, { x: npc.getLocation().getX(), y: npc.getLocation().getY() });
    if (distance < bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestCave(player) {
  const { MapObjects } = Common.core;
  const here = player.getLocation();
  const radius = crab().caveTiles;
  let best = null;
  let bestDistance = Infinity;
  for (let x = here.getX() - radius; x <= here.getX() + radius; x++) {
    for (let y = here.getY() - radius; y <= here.getY() + radius; y++) {
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, here.getZ())) ?? []) {
        const definition = object.getDefinition?.();
        if (definition?.getName?.() !== crab().cave || optionIndex(definition.getInteractions?.(), crab().caveOption) === 0) continue;
        const distance = Math.max(Math.abs(here.getX() - x), Math.abs(here.getY() - y));
        if (distance < bestDistance) {
          best = object;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function optionIndex(options, option) {
  const wanted = String(option).toLowerCase();
  return (options ?? []).findIndex((entry) => typeof entry === "string" && entry.toLowerCase() === wanted) + 1;
}

/** The gems in the inventory to the bank, recorded with the fight's XP. */
function bankGems(player) {
  const items = {};
  const inventory = player.getInventory();
  for (const name of crab().gems) {
    const itemId = Common.core.ItemIdentifiers?.[name];
    if (!Number.isInteger(itemId)) continue;
    const amount = inventory.getAmount(itemId);
    if (amount > 0 && Common.bank(player, itemId, amount)) {
      inventory.deleteNumber(itemId, amount);
      items[itemId] = amount;
    }
  }
  return items;
}

function record(player, items, now) {
  stateOf(player).recordedAt = now;
  Offline.record(player, "COMBAT", Common.combatSkillList(), items, Common.data.combat.maxGapSeconds);
}

function mine(player, shell) {
  const at = shell.getLocation();
  player.getMovementQueue().walkToEntity(shell, () => {
    player.setPositionToFace(at);
    Common.act(player, () => Common.api.emitNpcInteraction({
      player, npc: shell, npcId: shell.getId(), npcIndex: shell.getIndex(), clickType: optionIndex(shell.getDefinition().getActions(), crab().mineOption),
      location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
    }));
  });
}

function crawl(player, cave) {
  const at = cave.getLocation();
  player.getMovementQueue().walkToObject(cave, {
    execute: () => {
      player.setPositionToFace(at);
      Common.act(player, () => Common.api.emitObjectInteraction({
        player, object: cave, objectId: cave.getId(), clickType: optionIndex(cave.getDefinition().getInteractions(), crab().caveOption),
        location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
      }));
    },
  });
}

/** One look at an idle player fighting the crab; what it did, for the tests and logs. */
function look(player, now) {
  if (!fightingCrab(player) || !Common.autoOn(player) || Combat.pausedFor(player)) return "off";
  const state = stateOf(player);
  const gems = bankGems(player);
  if (Object.keys(gems).length > 0 || now - state.recordedAt >= crab().recordEverySeconds * 1000) record(player, gems, now);
  if (player.getCombat().getTarget()) return "fighting";
  if (state.mayMine) {
    const shell = nearest(player, crab().searchTiles, (npc) => npcName(npc) === crab().shell && !state.mined.has(npc));
    if (shell) {
      if (!Common.mayWork(player)) return "busy";
      state.mined.add(shell);
      state.mayMine = false;
      mine(player, shell);
      return "mining";
    }
  }
  if (nearest(player, crab().searchTiles, (npc) => npcName(npc) === crab().crab && npc.getHitpoints?.() > 1)) return "crab";
  const request = { player, tile: null };
  Common.api.emitCustomEvent("gemstone-crab:location", request);
  if (!request.tile) return "waiting";
  const [x, y, z = 0] = request.tile;
  const target = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE);
  if (target.anchor.x !== x || target.anchor.y !== y || target.anchor.z !== z) {
    Common.setActivity(player, Common.COMBAT_TARGET_ATTRIBUTE, { ...target, anchor: { x, y, z } });
  }
  if (player.getLocation().getZ() === z && Common.chebyshev(player.getLocation(), { x, y }) <= crab().followTiles) return "waiting";
  const cave = nearestCave(player);
  if (!cave) return "no-cave";
  if (!Common.mayWork(player)) return "busy";
  crawl(player, cave);
  return "following";
}

function tick() {
  const now = Date.now();
  for (const player of Combat.tracked) {
    if (player.isRegistered?.() === false) continue;
    look(player, now);
  }
}

function logout({ player }) {
  states.delete(player);
}

function startTask() {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class IdleBossTask extends Task {
    constructor() { super(Math.max(1, Common.data.combat.tickInterval | 0)); }
    execute() { tick(); }
  })());
}

module.exports = function attach(api) {
  api.onCustomEvent("gemstone-crab:burrowed", burrowed);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
};

module.exports.isBoss = isBoss;
module.exports.look = look;
module.exports.handlers = { burrowed };

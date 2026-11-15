/**
 * Zalcano's prison under Prifddinas (Wiki: Zalcano, Teleport_Platform, Barrier_(Zalcano)), shared
 * by everyone on the world:
 * - the Teleport Platform in the Trahaearn district (Song of the Elves) takes players down; the
 *   one inside takes them back up;
 * - the barrier lets players Pass into the room, or Peek at how many are inside and whether she
 *   has taken damage;
 * - while anyone is in the room she is there (her world spawn is replaced by this one); after a
 *   kill she comes back 37 ticks later; when the room empties she goes, and the rocks with her;
 * - hits: only imbued tephra hurts her armour or a golem, only mining hurts her once fallen;
 *   at 0 armour she falls instead of dying.
 * Fight.Zalcano.js runs one fight, Tephra.Zalcano.js the players' actions, Rewards.Zalcano.js the
 * kill.
 */
const Common = require("./Common.Zalcano");
const { Fight, DOWN, DEAD } = require("./Fight.Zalcano");
const Tephra = require("./Tephra.Zalcano");
const Rewards = require("./Rewards.Zalcano");

const prison = {
  area: null,
  fight: null,
  task: null,
  tickCount: 0,
  respawnAt: -1,
  depletedRocks: null,
};

// --- The world the fight acts on

const world = {
  spawnNpc(id, tile) {
    const { NPC, World } = Common.core;
    const npc = NPC.create(id, Common.toLocation(tile));
    npc.__skipDefaultRespawn = true;
    npc.setFlag?.("combat:no-regen");
    npc.setScriptedMovement?.(true);
    World.getAddNPCQueue().push(npc);
    return npc;
  },
  removeNpc(npc) {
    if (!npc) return;
    const { World } = Common.core;
    const addQueue = World.getAddNPCQueue();
    for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
    const removeQueue = World.getRemoveNPCQueue();
    if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
  },
  placeObject(id, tile) {
    const { GameObject, ObjectManager } = Common.core;
    const object = new GameObject(id, Common.toLocation(tile), 10, 0, null);
    ObjectManager.register(object, true);
    return object;
  },
  removeObject(object) {
    if (object) Common.core.ObjectManager.deregister(object, true);
  },
};

function players() {
  return prison.area ? prison.area.getPlayers().filter((player) => player?.isRegistered?.() !== false && Common.onFloor(player.getLocation())) : [];
}

// --- The fight's life

function startFight() {
  removeDepletedRocks();
  prison.fight = new Fight(world, players);
  prison.fight.start();
  prison.respawnAt = -1;
}

function removeDepletedRocks() {
  for (const rock of prison.depletedRocks ?? []) world.removeObject(rock);
  prison.depletedRocks = null;
}

function tick() {
  prison.tickCount += 1;
  const inside = prison.area?.getPlayers?.() ?? [];
  if (inside.length === 0) {
    endAll();
    return;
  }
  if (!prison.fight && prison.respawnAt >= 0 && prison.tickCount >= prison.respawnAt) startFight();
  if (!prison.fight && prison.respawnAt < 0) startFight();
  const fight = prison.fight;
  fight?.tick();
  // Killed with nobody left to credit (NPCDeathTask then emits no death): the kill still ends.
  if (fight && fight.seen && fight.npc.isRegistered?.() === false && prison.fight === fight) {
    if (fight.hp <= 0 && fight.phase === DOWN) zalcanoDied(fight);
    else endAll();
  }
  Tephra.tickActions(prison, inside);
}

function ensureRunning() {
  if (prison.task) return;
  const { Task, TaskManager } = Common.core;
  prison.task = new (class extends Task {
    constructor() {
      super(1, "zalcano", false);
    }
    execute() {
      tick();
    }
  })();
  TaskManager.submit(prison.task);
}

/** The room is empty: she goes, and the rocks are left depleted. */
function endAll() {
  prison.fight?.stop();
  prison.fight = null;
  prison.respawnAt = -1;
  prison.task?.stop?.();
  prison.task = null;
  Tephra.actions.clear();
  if (!prison.depletedRocks) prison.depletedRocks = Common.data.prison.rocks.map((tile) => world.placeObject(Common.ids.locs.rockDepleted, tile));
}

/** A kill: the rewards, then she is back 37 ticks later. */
function zalcanoDied(fight) {
  if (prison.fight !== fight) return;
  fight.died();
  const contributions = new Map([...fight.contributions].filter(([player]) => players().includes(player)));
  Rewards.share(contributions, Math.random, fight.npc);
  prison.fight = null;
  prison.depletedRocks = fight.rocks;
  fight.rocks = [];
  fight.stop();
  prison.respawnAt = prison.tickCount + Common.data.zalcano.respawnTicks;
}

// --- The area

let PrisonArea = null;

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.prison.bounds;
  PrisonArea = class ZalcanosPrison extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
    }

    getName() {
      return "Zalcano's prison";
    }

    postEnter(mobile) {
      if (!mobile?.isPlayer?.()) return;
      mobile.getAsPlayer().__zalPrison = prison;
      ensureRunning();
    }

    /** Tephra never leaves the prison (it crumbles as she rises, too). */
    postLeave(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      player.__zalPrison = null;
      Tephra.actions.delete(player);
      Tephra.removeTephra(player);
    }

    isMulti() {
      return true;
    }
  };
  return PrisonArea;
}

// --- Getting in and out

function platform({ player, objectId }) {
  const { locs } = Common.ids;
  if (objectId === locs.entrance) {
    if (!Common.questComplete(player)) {
      player.sendMessage(Common.message("needQuest"));
      return true;
    }
    player.moveTo(Common.toLocation(Common.data.prison.platform));
    return true;
  }
  if (objectId === locs.exit) {
    player.moveTo(Common.toLocation(Common.data.prison.outside));
    return true;
  }
  return false;
}

/** "Yes, and don't ask again." (recorded): the entry warning is skipped from then on. */
const SKIP_WARNING_ATTRIBUTE = "zalcano:skip-warning";

/**
 * Pass: going in, the recorded warning box and "Are you sure you wish to enter?" (Yes. / Yes, and
 * don't ask again. / No.) unless the player chose not to be asked; coming out, straight through.
 */
function pass({ player, objectId }) {
  if (objectId !== Common.ids.locs.barrier) return false;
  const { barrierNorth, barrierSouth } = Common.data.prison;
  const south = player.getLocation().getY() <= barrierSouth[1];
  const go = () => player.moveTo(Common.toLocation(south ? barrierNorth : barrierSouth));
  // The prison is south of the barrier: from the south is leaving (recorded facing north, no warning).
  if (south || player.getAttribute?.(SKIP_WARNING_ATTRIBUTE) === true) {
    go();
    return true;
  }
  Common.box(player, Common.message("entryWarning"), () => {
    Common.api.sendMultiChatboxPrompt(player, Common.message("entryQuestion"),
      Common.message("entryYes"), go,
      Common.message("entryAlways"), () => {
        player.setAttribute(SKIP_WARNING_ATTRIBUTE, true);
        go();
      },
      Common.message("entryNo"), () => {});
  });
  return true;
}

function peek({ player, objectId }) {
  if (objectId !== Common.ids.locs.barrier) return false;
  const count = (prison.area?.getPlayers?.() ?? []).length;
  const fight = prison.fight;
  const { hitpoints, shield } = Common.data.zalcano;
  const health = fight ? (fight.phase === DOWN ? fight.hp : fight.health) : hitpoints;
  const damaged = fight && (health < hitpoints || (fight.phase !== DOWN && fight.hp < shield));
  const players = count === 0 ? "no adventurers" : count === 1 ? "1 adventurer" : `${count} adventurers`;
  Common.box(player, Common.message("peek", {
    verb: count === 1 ? "is" : "are",
    players,
    health: Common.message(damaged ? "peekDamaged" : "peekFullHealth"),
  }));
  return true;
}

// --- Hits and deaths

const isZalcano = (npc) => [Common.ids.npcs.armoured, Common.ids.npcs.weakened].includes(npc?.getId?.());
const isGolem = (npc) => npc?.getId?.() === Common.ids.npcs.golem;

/** Only tephra on her armour and the golems, only mining once she has fallen. */
function hitModify({ npc, hit }) {
  if (!isZalcano(npc) && !isGolem(npc)) return;
  const fight = npc.__zalFight;
  const method = hit.getCombatMethod?.() ?? hit.method;
  const attacker = hit.getAttacker?.();
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const down = fight?.phase === DOWN && npc === fight.npc;
  const allowed = Boolean(fight) && fight.phase !== DEAD && (down ? Tephra.isMining(method) : Tephra.isThrow(method));
  const parts = hit.getHits?.() ?? [];
  if (!allowed) {
    for (const part of parts) part.setDamage(0);
    hit.updateTotalDamage?.();
    return;
  }
  const total = parts.reduce((sum, part) => sum + part.getDamage(), 0);
  if (isGolem(npc)) {
    fight.recordGolem(npc, player, Math.min(total, npc.getHitpoints()));
  } else {
    // What she didn't have left (more hits on the same tick) does nothing.
    let over = total - fight.land(player, total);
    for (const part of [...parts].reverse()) {
      if (over <= 0) break;
      const cut = Math.min(over, part.getDamage());
      part.setDamage(part.getDamage() - cut);
      over -= cut;
    }
    hit.updateTotalDamage?.();
  }
  if (player) Common.tileGraphic([player], npc.getLocation(), Common.ids.spotanims.oreHit);
}

/** At 0 armour she falls instead of dying; nothing but tephra and mining takes her down. */
function beforeDeath(event) {
  const npc = event.npc;
  const fight = npc?.__zalFight;
  if (!isZalcano(npc) || !fight || npc !== fight.npc) return;
  if (fight.hp > 0) {
    event.preventDeath = true;
    npc.setHitpoints(fight.hp);
    return;
  }
  if (npc.getId() === Common.ids.npcs.armoured) {
    event.preventDeath = true;
    fight.fall();
  }
}

function npcDied({ npc }) {
  const fight = npc?.__zalFight;
  if (!fight) return;
  if (npc === fight.npc) zalcanoDied(fight);
  else if (isGolem(npc)) fight.golems = fight.golems.filter((g) => g.npc !== npc);
}

/** NpcDrops: Zalcano's loot is Rewards'; a golem's tephra goes to whoever hurt it most. */
function claimDrops(claim) {
  const npc = claim.npc;
  if (isZalcano(npc)) {
    claim.handled = true;
    return;
  }
  if (!isGolem(npc) || !npc.__zalFight) return;
  claim.handled = true;
  const player = npc.__zalFight.golemKiller(npc) ?? (claim.killer?.isPlayer?.() ? claim.killer : null);
  if (!player) return;
  const request = { player, npcId: Common.ids.npcs.golem, drops: [] };
  Common.api.emitCustomEvent("npc-drops:roll-table", request);
  Common.api.emitCustomEvent("npc-drops:place", { player, drops: request.drops, location: npc.getLocation(), npcId: Common.ids.npcs.golem });
}

/** Her world spawn stays out: the prison spawns her while anyone is there. */
function blockWorldSpawn(event) {
  if (event.npcId !== Common.ids.npcs.armoured || !event.location) return;
  const x = event.location.getX?.() ?? event.location.x;
  const y = event.location.getY?.() ?? event.location.y;
  const [minX, maxX, minY, maxY] = Common.data.prison.bounds;
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) event.allow = false;
}

// --- Actions in the room

const mineRock = (event) => Tephra.mineRock(prison, event);
const refine = (event) => Tephra.refine(prison, event);
const imbue = (event) => Tephra.imbue(prison, event);
const mineZalcano = (event) => Tephra.mineZalcano(prison, event);

function onLogin({ player }) {
  Rewards.sendKills(player);
}

function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(SKIP_WARNING_ATTRIBUTE, false);
  prison.area = new (defineArea())();
  api.registerArea(prison.area);
  api.onObjectInteraction("Teleport Platform", { Channel: platform });
  api.onObjectInteraction("Barrier", { Pass: pass, Peek: peek });
  api.onObjectInteraction("Rock Formation (Glowing)", { Mine: mineRock });
  api.onObjectInteraction("Rock Formation", { Mine: mineRock });
  api.onObjectInteraction("Furnace", { Refine: refine });
  api.onObjectInteraction("Altar", { Imbue: imbue });
  api.onNpcInteraction("Zalcano", { Mine: mineZalcano });
  api.registerCombatMethodResolver({ resolve: Tephra.resolveMethod });
  api.onNpcHitModify(hitModify);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(npcDied);
  api.onCustomEvent("npc-drops:claim", claimDrops);
  api.onCustomEvent("ironman:shared-kill-keeps", Rewards.ironmanKeeps);
  api.onCanSpawnNpc(blockWorldSpawn);
  api.onPlayerLogin(onLogin);
}

module.exports = {
  attach, prison, world, players, tick, startFight, endAll, zalcanoDied, platform, pass, peek,
  hitModify, beforeDeath, npcDied, claimDrops, blockWorldSpawn, defineArea,
};

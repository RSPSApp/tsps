/**
 * Sarachnis' lair in the Forthos Dungeon burial tomb (docs/sarachnis.md):
 * a multi-combat Area over the tomb with the boss HUD on the room's Sarachnis,
 * and private instances (Wiki: rented at the thick web, lasting until the player
 * leaves or logs out) as a PrivateArea over the same tiles with their own boss.
 * The public boss spawns from data/definitions/npc-spawns.json; the fight
 * (spawns, web, heal) lives in Fight.Sarachnis.js and the way in, in Entrance.
 */
const Common = require("./Common.Sarachnis");
const Fight = require("./Fight.Sarachnis");

let api = null;
let core = null;
let lair = null;
let LairArea = null;
let InstanceArea = null;
/** player -> { npc, current } for each HUD on show. */
const huds = new Map();

function bossFor(player) {
  const area = player.getPrivateArea?.() ?? null;
  if (area instanceof InstanceArea) return area.boss;
  for (const npc of player.getLocalNpcs?.() ?? []) {
    if (Common.isSarachnis(npc) && Common.inLair(npc.getLocation())) return npc;
  }
  return null;
}

function hudValues(player, npc) {
  return { player, npcId: npc.getId(), current: Math.max(0, npc.getHitpoints()), maximum: npc.getDefinition().getHitpoints() };
}

/** Keeps the player's HUD on the room's Sarachnis; called each tick they are inside. */
function syncHud(player) {
  const npc = bossFor(player);
  const shown = huds.get(player);
  const alive = npc != null && npc.isRegistered?.() !== false;
  if (!alive) {
    if (shown) hideHud(player, true);
    return;
  }
  if (!shown || shown.npc !== npc) {
    const values = hudValues(player, npc);
    huds.set(player, { npc, current: values.current });
    api.emitCustomEvent("boss-hud:show", values);
    return;
  }
  const current = Math.max(0, npc.getHitpoints());
  if (current === shown.current) return;
  shown.current = current;
  api.emitCustomEvent("boss-hud:update", { player, current });
}

function hideHud(player, fadeOut = false) {
  if (!huds.delete(player)) return;
  api.emitCustomEvent("boss-hud:hide", fadeOut ? { player } : { player, fade: false, afterTicks: 0 });
}

/** She and her spawns go for anyone in the room, and lose interest outside it. */
function aggressive(player, npc) {
  if (!Common.isSarachnis(npc) && !Common.isMinion(npc)) return null;
  if (!Common.inLair(player.getLocation())) return null;
  return true;
}

/**
 * Leaving the tomb breaks the fight both ways: she cannot keep hitting a player she
 * can no longer reach, and the player drops her as a target.
 */
function disengage(player) {
  if (!player?.isPlayer?.()) return;
  const me = player.getAsPlayer();
  for (const npc of me.getLocalNpcs?.() ?? []) {
    if (!Common.isSarachnis(npc) && !Common.isMinion(npc)) continue;
    try {
      if (npc.getCombat?.().getTarget?.() === me) npc.getCombat().reset?.();
    } catch { /* best effort */ }
    try {
      if (me.getCombat?.().getTarget?.() === npc) me.getCombat().reset?.();
    } catch { /* best effort */ }
  }
}

function spawnBoss(id, area) {
  const [x, y, z] = Common.SPAWN_TILE;
  const npc = api.spawnNpc({ id, x, y, z, wanderRadius: 0 });
  if (!npc) return null;
  npc.setFace(core.Direction.SOUTH);
  npc.__skipDefaultRespawn = true;
  npc.setMultiCombat?.(true);
  if (area) {
    area.add(npc);
    area.boss = npc;
  }
  Fight.reset(npc);
  return npc;
}

/** A kill in an instance: the next one 16 ticks later, while it has players. */
function onBossDeath({ npc }) {
  if (!Common.isSarachnis(npc)) return;
  const area = npc.getPrivateArea?.() ?? null;
  if (!(area instanceof InstanceArea)) return;
  if (area.boss !== npc) return;
  area.boss = null;
  area.respawn = Common.later(Common.RESPAWN_TICKS, () => {
    if (area.isDestroyed?.() !== true && area.getPlayers().length > 0) spawnBoss(Common.BOSS_ID, area);
  });
}

/** A private instance over the tomb's tiles, ending when its players are gone. */
function defineAreas() {
  const { Area, PrivateArea, Boundary } = core;
  const boundary = () => new Boundary(Common.LAIR.minX, Common.LAIR.maxX, Common.LAIR.minY, Common.LAIR.maxY, 0);

  LairArea = class SarachnisLair extends Area {
    constructor() {
      super([boundary()]);
    }

    getName() {
      return "Sarachnis' Lair";
    }

    isMulti() {
      return true;
    }

    process(mobile) {
      if (mobile.isPlayer?.()) syncHud(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (mobile.isPlayer?.()) {
        const player = mobile.getAsPlayer();
        hideHud(player);
        disengage(player);
      }
    }

    npcAggression(player, npc) {
      return aggressive(player, npc);
    }
  };

  InstanceArea = class SarachnisInstance extends PrivateArea {
    constructor(owner) {
      super([boundary()]);
      this.owner = owner;
      this.boss = null;
      this.respawn = null;
    }

    getName() {
      return "Sarachnis' Lair";
    }

    isMulti() {
      return true;
    }

    process(mobile) {
      if (mobile.isPlayer?.()) syncHud(mobile.getAsPlayer());
    }

    npcAggression(player, npc) {
      return aggressive(player, npc);
    }

    /** Leaving, teleporting, dying or logging out ends the instance with its NPCs. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) {
        const player = mobile.getAsPlayer();
        hideHud(player);
        disengage(player);
        player.setAttribute(Common.INSTANCE_ATTRIBUTE, logout === true);
      }
      super.postLeave(mobile, logout);
      if (this.getPlayers().length === 0 || this.isDestroyed?.()) this.respawn?.stop();
    }
  };
}

/** A rented instance for `player`: entered, with its own Sarachnis. The caller walks the
 * player onto the other side of the web first, like the public way in. */
function createInstance(player) {
  const instance = new InstanceArea(player);
  instance.enter(player);
  player.setAttribute(Common.INSTANCE_ATTRIBUTE, true);
  spawnBoss(Common.BOSS_ID, instance);
  return instance;
}

/** A player who logged out in an instance logs in outside the thick web. */
function onLogin({ player }) {
  if (player.getAttribute(Common.INSTANCE_ATTRIBUTE) === true) {
    player.setAttribute(Common.INSTANCE_ATTRIBUTE, false);
    if (Common.inLair(player.getLocation())) player.moveTo(Common.location(Common.OUTSIDE_TILE));
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  defineAreas();
  lair = new LairArea();
  pluginApi.persistAttribute(Common.INSTANCE_ATTRIBUTE, false);
  pluginApi.registerArea(lair);
  pluginApi.onPlayerLogin(onLogin);
  pluginApi.onNpcDeath(onBossDeath);
}

module.exports = {
  attach,
  createInstance,
  get lair() { return lair; },
  _test: { huds, bossFor, syncHud, hideHud, aggressive, disengage, onBossDeath, onLogin, createInstance, defineArea: () => LairArea, instanceClass: () => InstanceArea, lair: () => lair },
};

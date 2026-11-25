"use strict";
const Common = require("./Common.DukeSucellus");
const Preparation = require("./Preparation.DukeSucellus");
const { Fight } = require("./Fight.DukeSucellus");
const Records = require("./Records.DukeSucellus");
let AreaClass;
function areaClass() {
  if (AreaClass)
    return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class DukeAsylum extends TemplatedInstanceArea {
    constructor() {
      super(Common.data.instance.width, Common.data.instance.height);
      this.session = null;
    }
    getName() {
      return "Duke Sucellus asylum";
    }
    /** The asylum plays Eye See You from arrival; the copied map has no track of its own. */
    getMusicTrack() {
      return Common.data.music.asylum;
    }
    allowSummonPet() {
      return false;
    }
    process(mobile) {
      const session = this.session;
      if (session && !session.ended && mobile === session.player && !mobile.isNeedsPlacement() && mobile.getRunningDirection() !== Common.core.Direction.NONE)
        session.ranSinceKill = true;
    }
    canAttack(attacker, target) {
      const session = this.session;
      if (target === session?.boss) {
        return attacker === session.player && session.fight.active && !session.fight.over;
      }
      if (attacker === session?.boss) {
        return target === session.player && session.fight.active && !session.fight.over;
      }
      return null;
    }
    postLeave(mobile, logout) {
      const session = this.session;
      if (session && mobile === session.player) {
        if (logout)
          mobile.setLocation(new Common.core.Location(...Common.data.site.outside));
        session.end();
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}
class Session {
  constructor(player) {
    this.player = player;
    this.area = new (areaClass())();
    this.area.session = this;
    this.ended = false;
    this.tick = 0;
    this.perfectKills = 0;
    this.ranSinceKill = false;
    this.passive = new Set();
    this.passiveExpiry = new Map();
    this.vats = new Map();
    this.tools = new Set();
    this.picks = { arder: 0, musca: 0 };
    this.meter = 0;
    this.action = null;
    const instance = Common.data.instance;
    for (let x = 0; x < instance.width; x++) {
      for (let y = 0; y < instance.height; y++) {
        this.area.setChunk(0, x, y, {
          sourceChunkX: instance.sourceChunkX + x,
          sourceChunkY: instance.sourceChunkY + y,
          sourcePlane: 0,
          rotation: 0,
        });
      }
    }
  }
  tile([x, y, z = 0]) {
    const instance = Common.data.instance;
    return this.area.tile(x - instance.sourceChunkX * 8, y - instance.sourceChunkY * 8, z);
  }
  place(id, tile, rotation = 0) {
    const object = new Common.core.GameObject(id, this.tile(tile), 10, rotation, this.area);
    Common.core.ObjectManager.register(object, true);
    return object;
  }
  spawnPassive(id, tile, face = 0) {
    const at = this.tile(tile), npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, face });
    if (!npc)
      return null;
    npc.__skipDefaultRespawn = true;
    npc.setFlag('combat:no-regen');
    npc.setScriptedMovement(true);
    npc.setUntargetable(true);
    npc.setFlag('combat:no-retaliate');
    this.area.add(npc);
    this.passive.add(npc);
    return npc;
  }
  removePassive(npc) {
    if (!npc || !this.passive.delete(npc))
      return;
    this.passiveExpiry.delete(npc);
    this.area.detach(npc);
    Common.api.removeNpc(npc);
  }
  setExit(active) {
    const site = Common.data.site;
    const object = new Common.core.GameObject(active ? site.escape : site.leave, this.tile(site.gate), 0, 3, this.area);
    Common.core.ObjectManager.register(object, true);
  }
  /** Spawns the sleeping Duke: on entry, and `respawn` after a kill. */
  reset(respawn = false) {
    if (this.ended)
      return;
    this.fight?.stop();
    if (this.boss) {
      this.area.detach(this.boss);
      Common.api.removeNpc(this.boss);
    }
    const tile = this.tile(Common.data.site.boss);
    this.boss = Common.api.spawnNpc({
      id: Common.data.npcs.awake,
      x: tile.getX(), y: tile.getY(), z: tile.getZ(),
      owner: this.player, wanderRadius: 0, face: Common.core.Direction.SOUTH.getId(),
    });
    if (!this.boss) {
      this.end();
      return;
    }
    this.boss.__skipDefaultRespawn = true;
    this.boss.setFlag("combat:no-regen");
    this.boss.setScriptedMovement(true);
    this.boss.setNpcTransformationId(Common.data.npcs.asleep);
    this.boss.setMaxHitpoints(Common.data.normal.meter);
    this.boss.setHitpoints(Common.data.normal.meter);
    this.area.add(this.boss);
    this.meter = 0;
    this.wakeAt = null;
    this.fight = new Fight(this, this.boss);
    this.boss.__dukeSucellusFight = this.fight;
    this.setExit(false);
    Preparation.refresh(this);
    if (respawn) {
      // 1751/91/3285: Duke falls back asleep (10182), the dead extremities return to their sleeping
      // locs and Eye See You replaces the kill's Prison Break.
      this.fight.placeEyes(0);
      this.fight.sleepEyes();
      this.boss.performAnimation(new Common.core.Animation(Common.data.animations.respawn));
      this.player.getPacketSender().sendSong(Common.data.music.asylum);
    }
    // The health HUD shows the sleeping Duke's poison meter from his spawn (varp 1683 = 12167).
    Common.api.emitCustomEvent("boss-hud:show", { player: this.player, npcId: Common.data.npcs.asleep, current: this.meter, maximum: Common.data.normal.meter });
  }
  process() {
    if (this.ended)
      return;
    if (!this.player.isRegistered()) {
      this.end();
      return;
    }
    if (this.player.getHitpoints() <= 0) {
      this.fight?.stop();
      return;
    }
    this.tick++;
    for (const [npc, due] of this.passiveExpiry)
      if (this.tick >= due)
        this.removePassive(npc);
    Preparation.process(this);
    this.fight?.process();
  }
  end() {
    if (this.ended)
      return;
    this.ended = true;
    this.action = null;
    this.fight?.stop();
    Common.sessions.delete(this.player);
    Common.clearSupplies(this.player);
    this.player.setAttribute(Common.INSIDE, false);
    Common.api.emitCustomEvent("boss-hud:hide", { player: this.player, fade: false, afterTicks: 0 });
    if (this.player.getPrivateArea() === this.area)
      this.area.remove(this.player);
    if (this.boss) {
      this.area.detach(this.boss);
      Common.api.removeNpc(this.boss);
    }
    for (const npc of [...this.passive])
      this.removePassive(npc);
    if (!this.area.isDestroyed())
      this.area.destroy();
  }
}
function enter(player) {
  if (Common.sessionOf(player))
    return false;
  const request = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  if (!request.complete)
    return false;
  const session = new Session(player);
  Common.sessions.set(player, session);
  try {
    player.getMovementQueue().reset();
    player.getCombat().reset();
    session.area.enter(player);
    player.moveTo(session.tile(Common.data.site.arrival));
    player.setAttribute(Common.INSIDE, true);
    session.reset();
    const { Task, TaskManager } = Common.core;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        if (session.ended) {
          this.stop();
          return;
        }
        session.process();
      }
    })());
    return true;
  }
  catch (error) {
    session.end();
    player.moveTo(new Common.core.Location(...Common.data.site.outside));
    throw error;
  }
}
function leave(player) {
  const session = Common.sessionOf(player);
  if (!session)
    return false;
  player.moveTo(new Common.core.Location(...Common.data.site.outside));
  session.end();
  return true;
}
function atTile(location, [x, y, z = 0]) {
  return (location?.getX?.() ?? location?.x) === x &&
    (location?.getY?.() ?? location?.y) === y &&
    (location?.getZ?.() ?? location?.z) === z;
}
/**
 * This entry's base multiloc is unnamed in cache 241, so it needs the generic
 * fallback. All asylum objects below use their cache names and action hooks.
 */
function postquestDoor(event) {
  const { player } = event;
  const door = Common.data.site.postquestDoor;
  const id = event.objectId ?? event.definition?.id;
  const location = event.location ?? event.object?.getLocation();
  if (Common.sessionOf(player) || id !== door.id || !atTile(location, door.tile))
    return false;
  const request = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  if (!request.complete)
    return false;
  player.getMovementQueue().reset();
  player.getCombat().reset();
  player.moveTo(new Common.core.Location(...Common.data.site.outside));
  event.handled = true;
  return true;
}
function gate(event) {
  const { player } = event;
  const session = Common.sessionOf(player);
  const id = event.objectId ?? event.definition?.id;
  const site = Common.data.site;
  if (session && player.getPrivateArea?.() === session.area) {
    if (![site.escape, site.leave, site.entry].includes(id))
      return false;
    return leave(player);
  }
  const location = event.location ?? event.object?.getLocation();
  return id === site.entry && atTile(location, site.gate) && enter(player);
}
function preparationObject(event) {
  return Preparation.object(event);
}
function beforePlayerDeath({ player }) {
  const s = Common.sessionOf(player);
  if (!s)
    return;
  Common.clearSupplies(player);
  if (!s.deathRecorded) {
    s.deathRecorded = true;
    Records.died(player);
  }
}
function disconnect({ player }) {
  Common.sessionOf(player)?.end();
}
function login({ player }) {
  if (!player.getAttribute(Common.INSIDE) || Common.sessionOf(player))
    return;
  player.setAttribute(Common.INSIDE, false);
  Common.clearSupplies(player);
  player.moveTo(new Common.core.Location(...Common.data.site.outside));
}
function grave(request) {
  if (!Common.sessionOf(request.player))
    return;
  const [x, y, z] = Common.data.site.outside;
  request.tile = { x, y, z };
  if (Common.kills(request.player) < 5)
    request.feeMultiplier = 0.25;
}
function counts({ player, counts: totals }) {
  const total = Common.count(player, Common.KILLS);
  if (total > 0)
    totals["Duke Sucellus"] = total;
}
function best(request) {
  if (request.monster === "Duke Sucellus")
    request.best = Common.count(request.player, Common.BEST);
}
function attach(api) {
  api.persistAttribute(Common.INSIDE, false);
  api.persistAttribute(Common.KILLS, 0);
  api.persistAttribute(Common.BEST, 0);
  api.onObjectInteraction(postquestDoor);
  api.onObjectInteraction("Gate", { Open: gate, Escape: gate, "Quick-escape": gate, Leave: gate });
  api.onObjectInteraction("Arder mushrooms", { Pick: preparationObject });
  api.onObjectInteraction("Musca mushrooms", { Pick: preparationObject });
  api.onObjectInteraction("Salt Deposit", { Mine: preparationObject });
  api.onObjectInteraction("Fermentation Vat", {
    Fill: preparationObject, Check: preparationObject, Empty: preparationObject, "Collect-from": preparationObject,
  });
  api.onObjectInteraction("Pestle and mortar", { Take: preparationObject });
  api.onObjectInteraction("Pickaxe", { Take: preparationObject });
  api.onPlayerBeforeDeath(beforePlayerDeath);
  api.onPlayerDisconnect(disconnect);
  api.onPlayerLogin(login);
  api.onCustomEvent("gravestones:grave-location", grave);
  api.onCustomEvent("combat-achievements:kill-count", counts);
  api.onCustomEvent("combat-achievements:personal-best", best);
}
module.exports = { Session, enter, leave, attach, postquestDoor, gate, grave, login, beforePlayerDeath };

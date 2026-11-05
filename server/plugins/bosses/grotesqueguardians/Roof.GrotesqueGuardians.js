/**
 * The Slayer Tower roof (Wiki: Grotesque Guardians/Strategies), a private copy per player
 * (the engine's PrivateArea pattern, as Vorkath's crater). The entrance, bell and exit follow
 * rsprox recordings of the roof (the PR #976 review):
 * - the Roof Entrance on the tower's top floor is locked until a brittle key (slayer_roof_key) is
 *   used on it - absorbed by the gateway, which stays open for good (varbit gargboss_unlocked_roof);
 * - going through needs a gargoyle or Guardians task; the passageway takes the player up with a
 *   fade, arriving 5 ticks after the click;
 * - ringing the Cloister Bell (Ring / Quick-start): the player strikes it, the bell swings with its
 *   sound, and the statues come down about 4 ticks later; ringing again mid-fight:
 *   "Concentrate on your fight!";
 * - the Roof Exit (Escape / Quick-escape) takes the player down with a fade, 3 ticks after the
 *   click; a teleport, death or logging out ends the copy, and a player logging out on the roof
 *   comes back by the entrance;
 * - weapons: Dusk only takes melee, Dawn takes ranged, magic or a halberd's melee; neither can be
 *   hurt while the fight says so (Fight.GrotesqueGuardians.js).
 */
const Common = require("./Common.GrotesqueGuardians");
const { Fight } = require("./Fight.GrotesqueGuardians");

const ROOF_ATTRIBUTE = "grotesque-guardians:roof";

let RoofClass = null;

class Roof {
  constructor(player) {
    this.player = player;
    const [minX, maxX, minY, maxY] = Common.data.roof.floor;
    this.floor = { minX, maxX, minY, maxY };
    this.area = new RoofClass(this);
    this.fight = null;
    this.dusk = null;
    this.dawn = null;
    /** The bell rung, the statues not down yet. */
    this.waking = false;
    this.startedAt = -1;
  }

  /** Whether a tile is on the walkable roof (where hazards can fall). */
  contains(location) {
    const { minX, maxX, minY, maxY } = this.floor;
    const x = location.getX();
    const y = location.getY();
    return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  players() {
    return this.player.isRegistered?.() !== false && this.area.getPlayers().includes(this.player) ? [this.player] : [];
  }

  spawn(id, tile) {
    const { NPC, World } = Common.core;
    const npc = NPC.create(id, Common.toLocation(tile));
    npc.__skipDefaultRespawn = true;
    npc.__ggRoof = this;
    npc.setFlag?.("combat:no-regen");
    npc.getMovementCoordinator?.().setRadius?.(10);
    this.area.add(npc);
    World.getAddNPCQueue().push(npc);
    return npc;
  }

  /** The bell: both statues come down and the fight starts. */
  start() {
    const { ids, data } = Common;
    const sender = this.player.getPacketSender();
    sender.sendVarbit(ids.varbits.duskStatueHidden, 1);
    sender.sendVarbit(ids.varbits.dawnStatueHidden, 1);
    this.dusk = this.spawn(ids.npcs.duskPhase1, data.roof.dusk);
    this.dawn = this.spawn(ids.npcs.dawnPhase1, data.roof.dawn);
    this.dusk.performAnimation(new Common.core.Animation(ids.seqs.duskSpawn));
    this.dawn.performAnimation(new Common.core.Animation(ids.seqs.dawnSpawn));
    this.fight = new Fight(this, this.dusk, this.dawn);
    this.startedAt = Common.core.World.getProcessCycle();
  }

  fighting() {
    return Boolean(this.fight && !this.fight.stopped);
  }

  /** Both Guardians gone and the statues back (a refused bell, or after the kill). */
  clearGuardians() {
    const addQueue = Common.core.World.getAddNPCQueue();
    const removeQueue = Common.core.World.getRemoveNPCQueue();
    for (const npc of [this.dusk, this.dawn]) {
      if (!npc) continue;
      // Spawned this tick (a refused bell): still waiting to be added.
      for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
      if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
      this.area.detach?.(npc);
    }
    this.dusk = null;
    this.dawn = null;
    this.reset();
  }

  /** After the kill: the statues back on their plinths, ready for the bell. */
  reset() {
    this.fight?.stop();
    this.fight = null;
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Common.ids.varbits.duskStatueHidden, 0);
    sender.sendVarbit(Common.ids.varbits.dawnStatueHidden, 0);
  }

  destroy() {
    this.fight?.stop();
    this.fight = null;
    this.area.destroy();
  }
}

function defineAreaClass() {
  const { PrivateArea, Boundary } = Common.core;
  RoofClass = class GuardiansRoof extends PrivateArea {
    constructor(roof) {
      const [minX, maxX, minY, maxY] = Common.data.roof.bounds;
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.roof = roof;
    }

    getName() {
      return "Grotesque Guardians";
    }

    destroy() {
      if (this.isDestroyed?.() === true) return;
      const addQueue = Common.core.World.getAddNPCQueue();
      const removeQueue = Common.core.World.getRemoveNPCQueue();
      for (const entity of this.entities ?? []) {
        if (!entity?.isNpc?.()) continue;
        const npc = entity.getAsNpc();
        for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
        if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
      }
      super.destroy();
    }

    process(mobile) {
      const roof = this.roof;
      // The fight runs on the player's tick: an idle NPC isn't processed until something wakes it.
      if (mobile !== roof.player || !roof.fighting()) return;
      const players = roof.players();
      for (const guardian of [roof.dusk, roof.dawn]) {
        // Dawn in the sky (phase 2) doesn't chase the player round the roof.
        if (guardian === roof.dawn && roof.fight.phase === 2) continue;
        if (guardian && players[0] && guardian.getHitpoints() > 0 && guardian.getCombat().getTarget() !== players[0]) guardian.getCombat().attack(players[0]);
      }
      roof.fight.tick(players);
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile === this.roof.player) {
        if (logout) mobile.moveTo(Common.toLocation(Common.data.roof.outside));
        leaveRoof(mobile);
      }
      super.postLeave(mobile, logout);
    }

    isMulti() {
      return true;
    }
  };
}

function roofOf(player) {
  const roof = player.getAttribute?.(ROOF_ATTRIBUTE);
  return roof instanceof Roof && roof.area.isDestroyed?.() !== true ? roof : null;
}

function leaveRoof(player) {
  const roof = player.getAttribute?.(ROOF_ATTRIBUTE);
  player.setAttribute?.(ROOF_ATTRIBUTE, null);
  if (roof instanceof Roof) roof.destroy();
}

/**
 * The travel up or down: a message box, the screen fading out, the move `ticks` after the click,
 * and the fade back. The player can't walk off meanwhile.
 */
function travel(player, ticks, messageKey, move) {
  const movement = player.getMovementQueue?.();
  movement?.setBlockMovement?.(true)?.reset?.();
  Common.box(player, Common.message(messageKey));
  Common.later(Math.max(1, ticks - 2), () => Common.fade(player, true));
  Common.later(ticks, () => {
    movement?.setBlockMovement?.(false);
    if (!player.isRegistered?.()) return;
    move();
    Common.fade(player, false);
    Common.later(2, () => Common.closeFade(player));
  });
}

function goUp(player) {
  leaveRoof(player);
  const roof = new Roof(player);
  player.setAttribute(ROOF_ATTRIBUTE, roof);
  player.moveTo(Common.toLocation(Common.data.roof.arrive));
  const current = player.getArea?.();
  if (current && current !== roof.area) current.leave(player, false);
  roof.area.enter(player);
  return roof;
}

// --- The tower's top floor

function unlocked(player) {
  return player.getAttribute(Common.UNLOCKED_ATTRIBUTE) === true;
}

function sendUnlocked(player) {
  player.getPacketSender().sendVarbit(Common.ids.varbits.unlocked, unlocked(player) ? 1 : 0);
}

/** The Roof Entrance: locked until the key is used on it; then up, for a player on task. */
function entrance({ player, objectId }) {
  if (objectId !== Common.ids.locs.entrance) return false;
  if (!unlocked(player)) {
    player.sendMessage(Common.message("locked"));
    return true;
  }
  if (!Common.onTask(player)) {
    Common.box(player, Common.message("noTask"));
    return true;
  }
  travel(player, Common.data.travel.upTicks, "goUp", () => goUp(player));
  return true;
}

/** The brittle key used on the Roof Entrance: absorbed by the gateway, which opens for good. */
function keyOnEntrance(event) {
  const { player } = event;
  const key = Common.ids.items.key;
  if (event.objectId !== Common.ids.locs.entrance || event.itemId !== key) return;
  event.handled = true;
  if (unlocked(player)) return;
  player.getInventory().deleteNumber(key, 1);
  player.setAttribute(Common.UNLOCKED_ATTRIBUTE, true);
  sendUnlocked(player);
  Common.box(player, Common.message("unlocked"), key);
}

// --- The roof

/**
 * The Cloister Bell: the player strikes it, the bell swings (a loc animation) with its sound, and
 * the statues come down a few ticks later. Ring says so in a message box; Quick-start doesn't.
 */
function ringBell({ player, objectId, object, option }) {
  if (!Common.ids.locs.bell.includes(objectId)) return false;
  const roof = roofOf(player);
  if (!roof) return true;
  if (roof.fighting()) {
    player.sendMessage(Common.message("concentrate"));
    return true;
  }
  if (roof.waking) return true;
  const { Animation } = Common.core;
  const { ids, data } = Common;
  const sender = player.getPacketSender();
  player.performAnimation?.(new Animation(ids.seqs.ringBell));
  if (object) sender.sendObjectAnimation(object, new Animation(ids.seqs.bell));
  sender.sendSound(data.bell.sound, 1, data.bell.soundDelay);
  if (option !== "Quick-start") Common.box(player, Common.message("ring"));
  roof.waking = true;
  Common.later(data.bell.wakeTicks, () => {
    roof.waking = false;
    if (roof.area.isDestroyed?.() === true || !roof.players().length || roof.fighting()) return;
    roof.start();
  });
  return true;
}

function escape({ player, objectId }) {
  if (objectId !== Common.ids.locs.exit || !roofOf(player)) return false;
  travel(player, Common.data.travel.downTicks, "goDown", () => {
    if (!roofOf(player)) return;
    player.moveTo(Common.toLocation(Common.data.roof.outside));
    leaveRoof(player);
  });
  return true;
}

// --- Hits

function isHalberd(player) {
  const { WeaponInterfaces } = Common.core;
  return Boolean(WeaponInterfaces) && player.getWeapon?.() === WeaponInterfaces.HALBERD;
}

/** Dusk: melee only; Dawn: ranged, magic or a halberd; neither while protected. */
function guardianHit({ npc, hit }) {
  const dusk = Common.isDusk(npc);
  const dawn = Common.isDawn(npc);
  if (!dusk && !dawn) return;
  const fight = npc.__ggFight;
  const attacker = hit.getAttacker?.();
  const type = hit.getCombatType?.();
  const { CombatType } = Common.core;
  let blocked = !fight || !fight.vulnerable(npc);
  if (attacker?.isPlayer?.()) {
    const player = attacker.getAsPlayer();
    if (dusk && type !== CombatType.MELEE) blocked = true;
    if (dawn && type === CombatType.MELEE && !isHalberd(player)) blocked = true;
  }
  const parts = hit.getHits?.() ?? [];
  if (blocked) {
    for (const part of parts) part.setDamage(0);
    hit.updateTotalDamage?.();
    if (attacker?.isPlayer?.() && dusk) {
      // Ranged and magic: his armour; melee while he can't be hurt: his wing (rsprox lines).
      attacker.getAsPlayer().sendMessage(Common.message(type !== CombatType.MELEE ? "immuneRanged" : "wing"));
    }
    return;
  }
  // A hit stops at the phase's threshold: Dawn flies up, or Dusk turns defensive, at 225.
  const floor = (dawn && fight.phase === 1) || (dusk && fight.phase === 2) ? Common.data.phases.dawnFliesBelow : 0;
  if (floor <= 0) return;
  let over = parts.reduce((sum, part) => sum + part.getDamage(), 0) - Math.max(0, npc.getHitpoints() - floor);
  for (const part of [...parts].reverse()) {
    if (over <= 0) break;
    const cut = Math.min(over, part.getDamage());
    part.setDamage(part.getDamage() - cut);
    over -= cut;
  }
  hit.updateTotalDamage?.();
}

/** The world's own Dusk on the roof stays out: each player gets theirs. */
function blockWorldSpawn(event) {
  if (!Common.isDusk({ getId: () => event.npcId }) || !event.location) return;
  const [minX, maxX, minY, maxY] = Common.data.roof.bounds;
  const x = event.location.getX?.() ?? event.location.x;
  const y = event.location.getY?.() ?? event.location.y;
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) event.allow = false;
}

function leaveWorld({ player }) {
  if (roofOf(player)) player.moveTo(Common.toLocation(Common.data.roof.outside));
  leaveRoof(player);
}

function onLogin({ player }) {
  sendUnlocked(player);
}

function attach(api) {
  defineAreaClass();
  api.persistAttribute(Common.UNLOCKED_ATTRIBUTE, false);
  api.onObjectInteraction("Roof Entrance", { Unlock: entrance, "Go-through": entrance });
  api.onItemOnObject(keyOnEntrance);
  api.onObjectInteraction("The Cloister Bell", { Ring: ringBell, "Quick-start": ringBell });
  api.onObjectInteraction("Roof Exit", { Escape: escape, "Quick-escape": escape });
  api.onNpcHitModify(guardianHit);
  api.onCanSpawnNpc(blockWorldSpawn);
  api.onPlayerLogin(onLogin);
  api.onPlayerLogout(leaveWorld);
  api.onPlayerDisconnect(leaveWorld);
}

module.exports = { attach, Roof, roofOf, goUp, leaveRoof, entrance, keyOnEntrance, ringBell, escape, guardianHit, blockWorldSpawn, isHalberd, ROOF_ATTRIBUTE };

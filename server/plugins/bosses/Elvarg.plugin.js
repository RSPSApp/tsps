const { DragonfireProtectionTier, emitDragonfireBreath, getDragonfireProtectionTier, sendDragonfireMessages } = require("../combat/DragonfireProtection");

let pluginApi;
const encounters = new WeakMap();
const ELVARG_BASE_ID = 816;
const ELVARG_IDS = [ELVARG_BASE_ID, 817, 8033, 6349];
const ELVARG_KILLED_ATTRIBUTE = "dragon-slayer:elvarg-killed";
const INSIDE_LAIR_ATTRIBUTE = "elvarg:inside-lair";
const MELEE_ANIMATION = 80;
const BREATH_ANIMATION = 81;
const BREATH_PROJECTILE = 130;
const BREATH_IMPACT = 131;
const BREATH_SOUND = 3750;
const BREATH_IMPACT_SOUND = 156;
const BREATH_LAUNCH_CYCLES = [51, 56, 61, 66, 71, 75];
const BREATH_END_CYCLES = [80, 85, 90, 95, 100, 105];
/** Her footprint (cache size 4). */
const ELVARG_SIZE = 4;
/** Ticks she tries to get off a player under her. Ours: boxed in, she must not wait forever (#489). */
const STEP_OFF_LIMIT_TICKS = 8;

function outsideWall() {
  return new pluginApi.core.Location(2845, 9636, 0);
}

function insideLair(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && at.getX() >= 2847 && at.getX() <= 2863 && at.getY() >= 9628 && at.getY() <= 9646;
}

function standsOver(npc, player) {
  const at = npc.getLocation(), them = player.getLocation();
  return at.getZ() === them.getZ() && them.getX() >= at.getX() && them.getX() < at.getX() + ELVARG_SIZE
    && them.getY() >= at.getY() && them.getY() < at.getY() + ELVARG_SIZE;
}

/** The next tile on her shortest open way off the player under her, or null if boxed in. */
function shortestStepOff(npc, player) {
  const at = npc.getLocation(), them = player.getLocation();
  const ways = [
    [-1, 0, at.getX() + ELVARG_SIZE - them.getX()],
    [1, 0, them.getX() - at.getX() + 1],
    [0, -1, at.getY() + ELVARG_SIZE - them.getY()],
    [0, 1, them.getY() - at.getY() + 1],
  ];
  const movement = npc.getMovementQueue();
  const open = ways.filter(([x, y]) => movement.canWalkTo(at.transform(x, y))).sort((a, b) => a[2] - b[2]);
  return open.length > 0 ? at.transform(open[0][0], open[0][1]) : null;
}

function createEncounter(player) {
  const { PrivateArea, Boundary } = pluginApi.core;
  return new (class ElvargArea extends PrivateArea {
    constructor() {
      super([new Boundary(2844, 2863, 9628, 9646, 0)]);
      this.owner = player;
      this.npc = null;
      this.active = false;
      this.killed = false;
      this.underTicks = 0;
      this.steppingOff = false;
      this.pluginName = "Elvarg";
    }
    /**
     * Wiki (Dragon Slayer I), stood under her: "it takes her a moment to move and hit you again". Large
     * NPCs otherwise fight on over a target under them (#489), which she goes back to if she can't get
     * clear. True while she's busy getting off the player, so combat is paused.
     */
    stepOff() {
      const { npc, owner } = this;
      if (!standsOver(npc, owner)) {
        this.underTicks = 0;
        this.stopSteppingOff();
        return false;
      }
      if (++this.underTicks > STEP_OFF_LIMIT_TICKS) {
        this.stopSteppingOff();
        return false;
      }
      this.steppingOff = true;
      // Scripted pauses her attacks; walking through entities lets her step while still over the player.
      npc.setScriptedMovement(true);
      npc.setFlag(pluginApi.core.NPC.WALK_THROUGH_ENTITIES_FLAG);
      // As the core's step-aside: she waits for a player who is walking.
      if (owner.getMovementQueue().size() > 0) return true;
      const step = shortestStepOff(npc, owner);
      if (step) npc.getMovementQueue().reset().addSteps(step);
      return true;
    }
    stopSteppingOff() {
      if (!this.steppingOff) return;
      this.steppingOff = false;
      this.npc.setScriptedMovement(false);
      this.npc.setFlag(pluginApi.core.NPC.WALK_THROUGH_ENTITIES_FLAG, false);
    }
    process(mobile) {
      if (mobile !== this.owner || !this.active || this.killed || !insideLair(this.owner)) return;
      if (this.owner.getHitpoints() <= 0 || this.npc?.getHitpoints() <= 0 || !this.npc?.isRegistered()) return;
      if (this.stepOff()) return;
      if (this.npc.getCombat().getTarget() !== this.owner) this.npc.getCombat().attack(this.owner);
    }
    canAttack(attacker, target) {
      if (!this.active || this.killed || !insideLair(this.owner)) return false;
      return (attacker === this.owner && target === this.npc) ||
        (attacker === this.npc && target === this.owner) ? null : false;
    }
    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        encounters.delete(this.owner);
        this.owner.setAttribute(INSIDE_LAIR_ATTRIBUTE, false);
        this.owner.getCombat().reset();
      }
      super.postLeave(mobile, logout);
    }
    destroy() {
      if (this.isDestroyed() || this.destroying) return;
      this.destroying = true;
      if (this.npc) pluginApi.removeNpc(this.npc);
      super.destroy();
    }
  })();
}

function enterLair(request) {
  const { player } = request;
  if (!player || request.handled || player.getAttribute(ELVARG_KILLED_ATTRIBUTE)) return;
  let area = encounters.get(player);
  if (!area || area.isDestroyed()) {
    area = createEncounter(player);
    encounters.set(player, area);
    area.enter(player);
    area.npc = pluginApi.spawnNpc({ id: ELVARG_BASE_ID, x: 2852, y: 9637, z: 0, owner: player, ownerOnly: true, wanderRadius: 5 });
    if (area.npc) area.add(area.npc);
    player.setAttribute(INSIDE_LAIR_ATTRIBUTE, true);
  }
  area.active = request.aggressive !== false;
  request.npc = area.npc;
  request.handled = true;
  area.process(player);
}

function leaveLair({ player }) {
  const area = encounters.get(player);
  if (area && player.getArea() === area) area.leave(player, false);
}

function elvargDied({ npc }) {
  const area = npc?.getArea();
  if (!area || area.npc !== npc || encounters.get(area.owner) !== area) return;
  area.stopSteppingOff();
  area.killed = true;
  area.active = false;
  npc.__skipDefaultRespawn = true;
  // Dragon Slayer keeps this area for the body and the timed head-cut sequence.
}

function cleanupPlayer({ player }) {
  const area = encounters.get(player);
  if (!area) return;
  player.setForceMovement(null);
  player.getMovementQueue().setBlockMovement(false);
  player.setUntargetable(false);
  leaveLair({ player });
  player.moveTo(outsideWall());
}

function restorePlayer({ player }) {
  if (!player.getAttribute(INSIDE_LAIR_ATTRIBUTE)) return;
  player.setAttribute(INSIDE_LAIR_ATTRIBUTE, false);
  player.moveTo(outsideWall());
}

function dragonfireDamage(player) {
  const { CombatEquipment, PrayerHandler, Misc } = pluginApi.core;
  const shield = CombatEquipment.hasDragonProtectionGear(player);
  const prayer = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC);
  const tier = getDragonfireProtectionTier(player);
  const potion = tier >= DragonfireProtectionTier.ANTIFIRE;
  const superPotion = tier >= DragonfireProtectionTier.SUPER_ANTIFIRE;
  const max = superPotion ? 0 : shield ? (prayer && potion ? 4 : prayer || potion ? 7 : 10) : prayer && potion ? 40 : prayer || potion ? 55 : 70;
  const message = shield ? "Your shield absorbs most of the dragon fire." :
    superPotion ? "You are completely protected from the dragon fire." :
      prayer || potion ? "You manage to resist some of the dragon fire." : "You're horribly burnt by the dragon fire!";
  player.sendMessage(message);
  sendDragonfireMessages(player, emitDragonfireBreath(null, player, []));
  const skills = player.getSkillManager(), prayerLevel = skills.getCurrentLevel(pluginApi.core.Skill.PRAYER);
  if (prayerLevel >= 10) skills.setCurrentLevels(pluginApi.core.Skill.PRAYER, prayerLevel - Math.floor(prayerLevel / 10));
  return max ? Misc.randomInclusive(0, max) : 0;
}

function breathe(character, target) {
  const { Animation, Graphic, Projectile, Misc } = pluginApi.core;
  character.performAnimation(new Animation(BREATH_ANIMATION));
  for (let i = 0; i < BREATH_LAUNCH_CYCLES.length; i++) {
    Projectile.createProjectile(character, target, BREATH_PROJECTILE,
      BREATH_LAUNCH_CYCLES[i], BREATH_END_CYCLES[i], 70, Misc.randomInclusive(70, 109))
      .withAngle(Misc.randomInclusive(8, 23)).withProgress(200).sendProjectile();
  }
  target.performGraphic(new Graphic(BREATH_IMPACT, 80, 90));
  const sender = target.getPacketSender?.();
  if (sender) {
    const source = character.getLocation(), at = target.getLocation();
    sender.sendAreaSound(BREATH_SOUND, source.getX(), source.getY(), source.getZ(), 1, 0, 15);
    sender.sendAreaSound(BREATH_IMPACT_SOUND, at.getX(), at.getY(), at.getZ(), 1, 80, 10);
  }
}

function installCombatMethod() {
  const { CombatMethod, CombatType, PendingHit, Animation, Misc } = pluginApi.core;
  class ElvargCombatMethod extends CombatMethod {
    constructor() { super(); this.dragonfire = true; }
    start(character, target) {
      this.dragonfire = character.calculateDistance(target) > 1 || Misc.randomInclusive(0, 1) === 0;
      if (this.dragonfire) breathe(character, target);
      else character.performAnimation(new Animation(MELEE_ANIMATION));
    }
    attackSpeed() { return 4; }
    attackDistance() { return 8; }
    type() { return this.dragonfire ? CombatType.MAGIC : CombatType.MELEE; }
    hits(character, target) {
      const hit = new PendingHit(character, target, this, { delay: this.dragonfire ? 3 : 1, rollAccuracy: !this.dragonfire });
      hit.setTotalDamage(this.dragonfire ? (target.isPlayer() ? dragonfireDamage(target.getAsPlayer()) : Misc.randomInclusive(0, 70)) : Math.min(8, hit.getTotalDamage()));
      // dragonfireDamage already applied Protect from Magic; leave the custom total alone.
      if (this.dragonfire) hit.markProtectionBypassed();
      return [hit];
    }
    handleAfterHitEffects() {}
    finished() {}
  }
  pluginApi.registerNpcCombatMethodProvider(ELVARG_IDS, ElvargCombatMethod, { singleton: false });
}

module.exports = {
  name: "Elvarg",
  register(api) {
    pluginApi = api;
    api.persistAttribute(INSIDE_LAIR_ATTRIBUTE, false);
    api.onServerStartup(installCombatMethod);
    api.onCustomEvent("elvarg:enter", enterLair);
    api.onCustomEvent("elvarg:leave", leaveLair);
    api.onNpcDeath(elvargDied);
    api.onPlayerLogin(restorePlayer);
    api.onPlayerLogout(cleanupPlayer);
    api.onPlayerDisconnect(cleanupPlayer);
  },
};

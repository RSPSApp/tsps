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
/**
 * The breath's heights as captured (start 70, end 70-109 in the packet). Projectile heights are
 * sent at four times the value passed (PacketSender.sendProjectile), so they are passed a quarter:
 * passing the packet values put the fire four times too high, over the player's head.
 */
const PROJECTILE_HEIGHT_SCALE = 4;
const BREATH_START_HEIGHT = 70;
const BREATH_END_HEIGHTS = [70, 109];
/**
 * The six projectiles land 60 + 10 cycles a tile after the breath, 5 apart, measured from her centre
 * tile (rev242 capture ticks 3489-3600: 90 at 3 tiles, 110 at 5, 140 at 8, 160 at 10); the impact
 * graphic waits for the first. The older capture's fixed 80-105 is the 2-tile case.
 */
const BREATH_END_BASE_CYCLES = 60;
const BREATH_END_STAGGER_CYCLES = 5;
/** The hit lands on the tick of the impact rounded down (floor), never sooner than 3 ticks: both captures. */
const BREATH_MIN_HIT_TICKS = 3;
const CYCLES_PER_TICK = 30;
/** Her centre tile, which the breath leaves from. */
const BREATH_SOURCE_OFFSET = 1;
/** Her lair's west edge: after the player climbs back over the wall she waits here (rev242 ticks 3494-3507). */
const LAIR_WEST_X = 2847;
const LAIR_SOUTH_Y = 9628;
const LAIR_NORTH_Y = 9646;
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

/** Cycles from the breath until its first projectile lands on `target`. */
function breathArrival(npc, target) {
  const at = npc.getLocation(), them = target.getLocation();
  const distance = Math.max(Math.abs(at.getX() + BREATH_SOURCE_OFFSET - them.getX()),
    Math.abs(at.getY() + BREATH_SOURCE_OFFSET - them.getY()));
  return BREATH_END_BASE_CYCLES + 10 * distance;
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
      /** The player is mid-jump over the wall into the lair: live moves them at once and she breathes a tick later. */
      this.entering = false;
      /** Climbed back out over the wall: she watches from the lair's edge. */
      this.watching = false;
      this.pluginName = "Elvarg";
    }
    engaged() {
      // `entering` counts only while the jump plays; a crossing cut short leaves the player outside.
      const jumping = this.entering && this.owner.getForceMovement?.() != null;
      return this.active && !this.killed && (jumping || insideLair(this.owner));
    }
    /**
     * Back over the wall, the player is still by her lair (this area reaches the wall's west side).
     * She stops, comes to the lair's west edge level with them and watches, but never breathes over
     * the wall (rev242 ticks 3494-3507). Walking off ends the encounter, as leaving the area does.
     */
    watchFromLair() {
      const { npc, owner } = this;
      if (!npc?.isRegistered() || npc.getHitpoints() <= 0 || insideLair(owner)) return;
      const at = owner.getLocation();
      const y = Math.min(Math.max(at.getY(), LAIR_SOUTH_Y), LAIR_NORTH_Y - ELVARG_SIZE + 1);
      const edge = new pluginApi.core.Location(LAIR_WEST_X, y, at.getZ());
      npc.setPositionToFace(at);
      const movement = npc.getMovementQueue();
      const here = npc.getLocation();
      if ((here.getX() !== edge.getX() || here.getY() !== edge.getY()) && movement.size() === 0) movement.addSteps(edge);
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
      if (mobile !== this.owner || this.killed) return;
      if (!this.active) { if (this.watching) this.watchFromLair(); return; }
      if (!this.engaged()) return;
      if (this.owner.getHitpoints() <= 0 || this.npc?.getHitpoints() <= 0 || !this.npc?.isRegistered()) return;
      if (this.stepOff()) return;
      if (this.npc.getCombat().getTarget() !== this.owner) this.npc.getCombat().attack(this.owner);
    }
    canAttack(attacker, target) {
      if (!this.engaged()) return false;
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
  area.entering = area.active && request.entering === true;
  area.watching = false;
  request.npc = area.npc;
  request.handled = true;
  area.process(player);
}

/** Back over the wall: she stands down and watches from the lair's edge until the player walks off. */
function leaveLair({ player }) {
  const area = encounters.get(player);
  if (!area || player.getArea() !== area) return;
  // After the kill there is nothing to watch: leaving ends the encounter and clears the corpse.
  if (area.killed) { area.leave(player, false); return; }
  area.active = false;
  area.watching = true;
  area.entering = false;
  area.stopSteppingOff();
  area.npc?.getCombat().reset();
  player.getCombat().reset();
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
  if (player.getArea() === area) area.leave(player, false);
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

/** Plays a breath at `target`; returns the cycles until it lands. */
function breathe(character, target) {
  const { Animation, Graphic, Projectile, Misc } = pluginApi.core;
  character.performAnimation(new Animation(BREATH_ANIMATION));
  const arrival = breathArrival(character, target);
  for (let i = 0; i < BREATH_LAUNCH_CYCLES.length; i++) {
    Projectile.createProjectile(character, target, BREATH_PROJECTILE,
      BREATH_LAUNCH_CYCLES[i], arrival + i * BREATH_END_STAGGER_CYCLES,
      BREATH_START_HEIGHT / PROJECTILE_HEIGHT_SCALE, Misc.randomInclusive(...BREATH_END_HEIGHTS) / PROJECTILE_HEIGHT_SCALE)
      .withAngle(Misc.randomInclusive(8, 23)).withProgress(200).sendProjectile();
  }
  target.performGraphic(new Graphic(BREATH_IMPACT, arrival, 90));
  const sender = target.getPacketSender?.();
  if (sender) {
    const source = character.getLocation(), at = target.getLocation();
    sender.sendAreaSound(BREATH_SOUND, source.getX(), source.getY(), source.getZ(), 1, 0, 15);
    sender.sendAreaSound(BREATH_IMPACT_SOUND, at.getX(), at.getY(), at.getZ(), 1, arrival, 10);
  }
  return arrival;
}

function installCombatMethod() {
  const { CombatMethod, CombatType, PendingHit, Animation, Misc } = pluginApi.core;
  class ElvargCombatMethod extends CombatMethod {
    constructor() { super(); this.dragonfire = true; this.breathTicks = BREATH_MIN_HIT_TICKS; }
    start(character, target) {
      this.dragonfire = character.calculateDistance(target) > 1 || Misc.randomInclusive(0, 1) === 0;
      if (this.dragonfire) {
        this.breathTicks = Math.max(BREATH_MIN_HIT_TICKS, Math.floor(breathArrival(character, target) / CYCLES_PER_TICK));
        breathe(character, target);
      } else character.performAnimation(new Animation(MELEE_ANIMATION));
    }
    attackSpeed() { return 4; }
    attackDistance() { return 8; }
    type() { return this.dragonfire ? CombatType.MAGIC : CombatType.MELEE; }
    hits(character, target) {
      const hit = new PendingHit(character, target, this, { delay: this.dragonfire ? this.breathTicks : 1, rollAccuracy: !this.dragonfire });
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
  description: "Elvarg for Dragon Slayer: her lair, melee and dragonfire breath checked against antifire protection, and her kill state.",
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

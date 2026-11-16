/**
 * Elder Chaos druids (Wilderness, level 129): a magic attacker that casts Wind Wave and Tele Block
 * (https://oldschool.runescape.wiki/w/Elder_Chaos_druid: max hit 17, attack speed 4).
 *
 * rsprox captures (recordings 435, 437, 438; npc wilderness_chaos_druid):
 * - Wind Wave: sequence 11429, graphic 158 at height 92, projectile 159 (start 32, end 32 + 10 a
 *   tile, never under 60, heights 172 -> 124, angle 16, progress 64), sounds 222 and 227 on landing.
 * - Tele Block: sequence 1819, projectile 1299 (start 30, end 69 whatever the distance, same
 *   heights), graphic 345 on the target at cycle 69, sounds 202 at the druid and 203 on landing.
 *   The target is told at the cast, and a new block only took hold when none was running or the
 *   running one had at most 10-18 ticks left (recasts at 10, 16 and 18 ticks left refreshed it to
 *   the full time; casts at 236 ticks left did nothing).
 * - Protect from Magic halves the block (2 minutes 30 seconds against 5 minutes).
 *
 * The pull (https://oldschool.runescape.wiki/w/Elder_Chaos_druid and its transcript; no capture
 * has it): the druids teleport fleeing players to within melee distance, saying "You dare run from
 * us!", up to 20 tiles away (Mod Ash, 19 July 2021). They pull the fleeing player who has done them
 * the most damage first, even while attacking someone else, and never a player attacking them.
 * A read teleport anchoring scroll stops it: the "combat:npc-teleports-player" event lets that
 * plugin set `blocked` (issue 6013).
 * Ours: "fleeing" is a recent damager who attacks nothing, stands beyond melee distance and is
 * walking or running; the pull takes the druid's attack turn, needs a clear line for a spell and
 * lands on the free tile beside the druid nearest the player. No animation, graphic or sound: no
 * source shows one.
 */
/** How the cast message names the caster (recordings 435, 437, 438). */
const CASTER_NAME = "an Elder Chaos druid";
const WIND_WAVE = { anim: 11429, graphic: 158, graphicHeight: 92, projectile: 159, castSound: 222, landSound: 227 };
const WIND_WAVE_START = 32;
const WIND_WAVE_MIN_END = 60;
const TELE_BLOCK = { anim: 1819, projectile: 1299, impact: 345, castSound: 202, landSound: 203 };
const TELE_BLOCK_START = 30;
const TELE_BLOCK_END = 69;
const PROJECTILE_ANGLE = 16;
const PROJECTILE_PROGRESS = 64;
const PROJECTILE_START_HEIGHT = 172;
const PROJECTILE_END_HEIGHT = 124;
const ATTACK_SPEED = 4;
const ATTACK_DISTANCE = 10;
/** A running block is recast when this few seconds (about 20 ticks) are left. */
const RECAST_SECONDS = 12;
/** The pull's overhead line (Wiki: Transcript:Elder Chaos druid). */
const PULL_LINE = "You dare run from us!";
/** Mod Ash: "Their max distance check on that attack is 20 tiles". */
const PULL_DISTANCE = 20;
/** Emitted before a pull with `{ npc, player, destination, blocked: false }`; set `blocked` to stop it. */
const PULL_EVENT = "combat:npc-teleports-player";
/** Melee distance: the four tiles sharing an edge with the druid. */
const BESIDE = [[0, -1], [-1, 0], [1, 0], [0, 1]];

let api;
let core;
let DruidMethod = null;
/** Druids that have been in combat and may still pull a recent damager. */
const active = new Set();
let pullTask = null;

function sendProjectile(npc, target, id, start, end) {
  core.Projectile.createProjectile(npc, target, id, start, end, PROJECTILE_START_HEIGHT, PROJECTILE_END_HEIGHT)
    .withAngle(PROJECTILE_ANGLE)
    .withProgress(PROJECTILE_PROGRESS)
    .sendProjectile();
}

function blockWanted(target) {
  if (!target?.isPlayer?.()) return false;
  const timer = target.getAsPlayer().getCombat().getTeleblockTimer();
  return !timer.isRunning() || timer.secondsRemaining() <= RECAST_SECONDS;
}

function playSound(npc, id, delay = 0) {
  core.Sounds.sendSound(npc, new core.Sound(id, 1, delay, 0));
}

function castWindWave(npc, target) {
  const { Animation, Graphic, Projectile } = core;
  npc.performAnimation(new Animation(WIND_WAVE.anim));
  const graphic = new Graphic(WIND_WAVE.graphic);
  graphic.height = WIND_WAVE.graphicHeight;
  npc.performGraphic(graphic);
  const distance = Projectile.centreOf(npc).getDistance(Projectile.centreOf(target));
  const end = Math.max(WIND_WAVE_MIN_END, WIND_WAVE_START + 10 * distance);
  sendProjectile(npc, target, WIND_WAVE.projectile, WIND_WAVE_START, end);
  playSound(npc, WIND_WAVE.castSound);
  return end;
}

function castTeleBlock(npc, target) {
  const { Animation, Graphic } = core;
  npc.performAnimation(new Animation(TELE_BLOCK.anim));
  sendProjectile(npc, target, TELE_BLOCK.projectile, TELE_BLOCK_START, TELE_BLOCK_END);
  playSound(npc, TELE_BLOCK.castSound);
  return TELE_BLOCK_END;
}

function flees(npc, player) {
  if (!player.isRegistered() || player.getHitpoints() <= 0 || player.isTeleportingReturn()) return false;
  if (player.getPrivateArea() !== npc.getPrivateArea()) return false;
  // Attacking the druid, or another target, is not fleeing.
  if (player.getCombat().getTarget() != null) return false;
  const distance = npc.getLocation().getDistance(player.getLocation());
  if (distance > PULL_DISTANCE || besideTiles(npc).some((tile) => tile.equals(player.getLocation()))) return false;
  return player.getMovementQueue().size() > 0;
}

function besideTiles(npc) {
  const at = npc.getLocation();
  return BESIDE.map(([dx, dy]) => new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
}

/** Ours: the open tile beside the druid that is nearest the player (ties keep BESIDE's order). */
function landingTile(npc, player) {
  const at = npc.getLocation();
  const area = npc.getPrivateArea();
  const from = player.getLocation();
  const open = besideTiles(npc).filter((tile) =>
    !core.RegionManager.blocked(tile, area) &&
    core.RegionManager.canMove(at.getX(), at.getY(), tile.getX(), tile.getY(), at.getZ(), 1, 1, area));
  open.sort((a, b) => a.distanceToPoint(from.getX(), from.getY()) - b.distanceToPoint(from.getX(), from.getY()));
  return open[0] ?? null;
}

/** The fleeing recent damager who did the druid the most damage, if a spell can reach them. */
function fleeingTarget(npc) {
  const entries = npc.getCombat().getRecentDamagerEntries()
    .filter(({ player }) => flees(npc, player))
    .sort((a, b) => b.damage - a.damage);
  for (const { player } of entries) {
    if (core.RegionManager.canProjectileAttackTarget(npc, player)) return player;
  }
  return null;
}

/** Teleports `player` beside the druid; false when no tile is free or a listener blocked it. */
function pull(npc, player) {
  const destination = landingTile(npc, player);
  if (!destination) return false;
  const event = { npc, player, destination, blocked: false };
  api.emitCustomEvent(PULL_EVENT, event);
  if (event.blocked) return false;
  npc.forceChat(PULL_LINE);
  player.moveTo(destination);
  const combat = npc.getCombat();
  combat.setAttackDelay(ATTACK_SPEED);
  if (combat.getTarget() == null) combat.attack(player);
  return true;
}

function idle(npc) {
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) return true;
  return npc.getCombat().getTarget() == null && npc.getCombat().getRecentDamagerEntries().length === 0;
}

/** Each tick, before NPC combat runs: a druid whose attack is ready pulls a fleeing damager. */
function processPulls() {
  for (const npc of active) {
    if (idle(npc)) {
      active.delete(npc);
      continue;
    }
    if (npc.getCombat().getAttackDelay() > 0) continue;
    const player = fleeingTarget(npc);
    if (player) pull(npc, player);
  }
  return active.size > 0;
}

function track(npc) {
  active.add(npc);
  if (pullTask?.isRunning()) return;
  pullTask = new (class extends core.Task {
    constructor() {
      super(1, false);
    }
    execute() {
      if (!processPulls()) this.stop();
    }
  })();
  core.TaskManager.submit(pullTask);
}

function methodClass() {
  if (DruidMethod) return DruidMethod;
  const { CombatMethod, CombatType, CombatFactory, PendingHit, Graphic, TeleBlock } = core;
  DruidMethod = class extends CombatMethod {
    constructor() {
      super();
      this.teleBlock = false;
      this.landing = 0;
    }

    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return ATTACK_DISTANCE;
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    onCombatBegan(npc) {
      track(npc);
    }

    start(npc, target) {
      // A fight begun by a cannon or a splash never calls onCombatBegan; every swing tracks too.
      track(npc);
      this.teleBlock = blockWanted(target);
      this.landing = this.teleBlock ? castTeleBlock(npc, target) : castWindWave(npc, target);
    }

    hits(npc, target) {
      const delay = core.Projectile.ticksToLand(this.landing);
      const hit = new PendingHit(npc, target, this, delay);
      if (this.teleBlock) {
        // The roll decides the block; the cast deals no damage. It still returns a splat-less hit so
        // the swing counts as an attack (under attack, retaliation) and a miss shows the splash.
        if (hit.isAccurate()) this.landTeleBlock(npc, target);
        return [hit.withoutHitsplat()];
      }
      CombatFactory.applyStyleDamage(hit, npc.getDefinition().getMaxHit());
      return [hit];
    }

    landTeleBlock(npc, target) {
      const impact = new Graphic(TELE_BLOCK.impact);
      impact.delay = TELE_BLOCK_END;
      target.performGraphic(impact);
      playSound(target, TELE_BLOCK.landSound, TELE_BLOCK_END);
      TeleBlock.apply(target.getAsPlayer(), CASTER_NAME);
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget?.();
      if (!target) return;
      if (hit.isAccurate()) return;
      target.performGraphic(core.MagicCombatMethod.SPLASH_GRAPHIC);
    }
  };
  return DruidMethod;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const { NpcIdentifiers } = core;
  api.registerNpcCombatMethodProvider(
    [NpcIdentifiers.ELDER_CHAOS_DRUID, NpcIdentifiers.ELDER_CHAOS_DRUID_2],
    methodClass(),
    { singleton: false }
  );
}

module.exports = {
  name: "ElderChaosDruid",
  description: "Adds the Wilderness Elder Chaos druid, a magic attacker casting Wind Wave and Tele Block with captured animations and projectiles, that teleports fleeing players back beside it.",
  members: true,
  register: attach,
  _test: { blockWanted, methodClass, track, flees, landingTile, fleeingTarget, pull, processPulls, active, PULL_EVENT },
};

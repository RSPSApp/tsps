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

let core;
let DruidMethod = null;

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

    start(npc, target) {
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

function attach(api) {
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
  description: "Adds the Wilderness Elder Chaos druid, a magic attacker casting Wind Wave and Tele Block with captured animations and projectiles.",
  members: true,
  register: attach,
  _test: { blockWanted, methodClass },
};

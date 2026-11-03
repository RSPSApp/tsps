"use strict";

/**
 * Kraken attack script (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Wiki (Kraken, Cave kraken, Enormous Tentacle): all three attack with Magic — the boss
 * and its tentacles typeless (prayer bypass lives in Typeless.Kraken.js), cave krakens
 * regular. The Kraken's projectile resembles Fire Wave; projectiles 156 (boss) and 162
 * (cave/tentacle) with impacts 157/163 are real spotanims in this cache (rev 241,
 * `yarn dump:spotanim`), matching that look. Surfacing and attack animations come from
 * the engine's own animation resolution (npc-animations.json + captures).
 * Speeds and max hits stay the dump's (monsters-complete.json: cave 6 ticks/max 13,
 * boss 4/max 28, tentacle 4/max 2 — the Wiki agrees on the tentacle's max 2).
 */

const Shared = require("./Shared.Kraken");

/**
 * Surfaced NPC id -> projectile and impact graphic, keyed from NpcIdentifiers (rule 4).
 * Ids verified with `yarn dump:spotanim 156 157 162 163` (rev 241: 156/162 share model
 * 3115 seq 692, 157/163 model 3116 seq 693), matching the Wiki's "resembles Fire Wave";
 * the same pair already drives Zulrah's magic (162/163) and Vorkath's dragonfire
 * impact (156). Travel heights/delay copy the engine's own NPC magic
 * (MagicCombatMethod.start: delay 0, speed 20, heights 43/31). ReasonPS pointed at
 * the same projectile family; the cache and Wiki above are the justification (rule 10).
 */
let SHOTS = null;
function shotsTable() {
  if (!SHOTS) {
    const { CAVE_KRAKEN, BOSS, TENTACLE } = Shared.ids();
    SHOTS = {
      [CAVE_KRAKEN]: { projectile: 162, impact: 163 },
      [BOSS]: { projectile: 156, impact: 157 },
      [TENTACLE]: { projectile: 162, impact: 163 },
    };
  }
  return SHOTS;
}
function shotsFor(npcId) {
  return shotsTable()[npcId] ?? shotsTable()[Shared.ids().BOSS];
}

let KrakenMethod = null;

function methodClass() {
  if (KrakenMethod) return KrakenMethod;
  const { Animation, CombatMethod, CombatType, Graphic, GraphicHeight, MagicCombatMethod, PendingHit, Projectile } = Shared.core();
  KrakenMethod = class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed(character) {
      return character.getCurrentDefinition?.()?.getAttackSpeed?.() ?? 4;
    }

    start(character, target) {
      const animation = character.getAttackAnim();
      if (animation !== -1) character.performAnimation(new Animation(animation));
      const { projectile } = shotsFor(character.getId());
      Projectile.createProjectile(character, target, projectile, 0, 20, 43, 31).sendProjectile();
    }

    hits(character, target) {
      // Lands with the shot, which flies the legacy 46 + 10 a tile, as the engine's NPC magic (#1862).
      return [new PendingHit(character, target, this, Projectile.arrivalTicks(character, target, Projectile.LEGACY_MAGIC_END_BASE))];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget?.();
      if (!target) return;
      if (hit.isAccurate()) {
        target.performGraphic(new Graphic(shotsFor(hit.getAttacker?.()?.getId?.()).impact, GraphicHeight.HIGH));
      } else {
        target.performGraphic(MagicCombatMethod.SPLASH_GRAPHIC);
      }
    }
  };
  return KrakenMethod;
}

function attach(api) {
  api.registerNpcCombatMethodProvider(
    [Shared.ids().CAVE_KRAKEN, Shared.ids().BOSS, Shared.ids().TENTACLE],
    methodClass(),
  );
}

module.exports = { attach, methodClass, shotsFor };

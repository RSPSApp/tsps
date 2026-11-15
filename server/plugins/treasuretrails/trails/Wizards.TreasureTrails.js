"use strict";

/**
 * Treasure Trails fights: the wizards' and double agents' shouts and the Zamorak wizard's spell
 * (Wiki "Zamorak wizard", "Saradomin wizard", "Double agent").
 *
 * As recorded:
 * - Each calls out its line the tick it appears: "Die, human!" (trail_hard, rsprox_transcripts/236/03930.txt
 *   tick 180 and 233/00452.txt), "For Saradomin!" (trail_hard2, 227/00091.txt) and "I expect you to die!"
 *   (double agents, 227/00127.txt). The Wiki gives the same three lines.
 * - The Zamorak wizard casts Flames of Zamorak (Wiki) every 4 ticks with sequence 811 (236/03930.txt
 *   ticks 180-257): a hit shows zamorak_flame (78, delay 64) on the player at the cast and the damage a
 *   tick later; a miss shows the splash (85, height 124, delay 56). Its first hit lowered Magic by
 *   1 + 5% (99 to 94) with "You feel your magical powers weaken."; later hits, Magic still lowered,
 *   drained nothing and said nothing (as the god spell's own rule: CombatSpells godSpellDrain).
 * - The Saradomin wizard (Wiki "Saradomin wizard") stabs with a poisoned dragon dagger and casts Saradomin
 *   Strike (sequence 811, seen in capture 227/00091.txt beside the dagger's 376). Within melee distance it
 *   counters an overhead prayer: Magic against Protect from Melee, melee against Protect from Magic. Further
 *   away it only has Magic.
 */
const SHOUTS = Object.freeze({
  ZAMORAK_WIZARD: "Die, human!",
  SARADOMIN_WIZARD: "For Saradomin!",
  DOUBLE_AGENT: "I expect you to die!",
  DOUBLE_AGENT_2: "I expect you to die!",
  DOUBLE_AGENT_3: "I expect you to die!",
});
const FLAMES = Object.freeze({ anim: 811, graphic: 78, graphicDelay: 64, splashDelay: 56 });
const FLAMES_MESSAGE = "You feel your magical powers weaken.";
const ATTACK_SPEED = 4;
const ATTACK_DISTANCE = 10;

let core = null;
let FlamesMethod = null;
let SaradominMethod = null;

/** The Saradomin wizard's style: melee next to the player unless Protect from Melee, otherwise Magic. */
function chooseStyle(adjacent, protectsMelee) {
  return adjacent && !protectsMelee ? "melee" : "magic";
}

/** The line an encounter NPC calls out as it appears, or null. */
function shoutFor(npcId) {
  const { NpcIdentifiers } = core;
  const key = Object.keys(SHOUTS).find(name => NpcIdentifiers[name] === npcId);
  return key ? SHOUTS[key] : null;
}

function shout(npc, npcId) {
  const line = shoutFor(npcId);
  if (line) npc.forceChat?.(line);
}

/** Magic down 1 + 5%, only from its base level (Wiki Flames of Zamorak; 236/03930.txt). */
function drainMagic(target) {
  if (!target?.isPlayer?.()) return;
  const skills = target.getAsPlayer().getSkillManager();
  const { Skill } = core;
  const current = skills.getCurrentLevel(Skill.MAGIC);
  if (current < skills.getMaxLevel(Skill.MAGIC)) return;
  skills.setCurrentLevelCombat(Skill.MAGIC, Math.max(0, current - (1 + Math.floor(current * 0.05))));
  target.getAsPlayer().sendMessage(FLAMES_MESSAGE);
}

function methodClass() {
  if (FlamesMethod) return FlamesMethod;
  const { CombatMethod, CombatType, CombatFactory, PendingHit, Animation } = core;
  FlamesMethod = class extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return ATTACK_DISTANCE;
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    start(npc) {
      npc.performAnimation(new Animation(FLAMES.anim));
    }

    hits(npc, target) {
      const hit = new PendingHit(npc, target, this, 1);
      CombatFactory.applyStyleDamage(hit, npc.getDefinition().getMaxHit());
      if (hit.isAccurate()) {
        target.performGraphic(new core.Graphic(FLAMES.graphic).withDelay(FLAMES.graphicDelay));
        drainMagic(target);
      } else {
        target.performGraphic(core.MagicCombatMethod.SPLASH_GRAPHIC.withDelay(FLAMES.splashDelay));
      }
      return [hit];
    }
  };
  return FlamesMethod;
}

function saradominMethodClass() {
  if (SaradominMethod) return SaradominMethod;
  const { CombatMethod, CombatType, CombatFactory, CombatSpells, MagicCombatMethod, PrayerHandler } = core;
  const prays = (target, prayer) => target.isPlayer() && PrayerHandler.isActivated(target.getAsPlayer(), prayer);

  /** Saradomin Strike, as the Mage Arena's battle mages cast it. */
  class StrikeMethod extends MagicCombatMethod {
    start(npc, target) {
      npc.getCombat().setCastSpell(CombatSpells.SARADOMIN_STRIKE);
      super.start(npc, target);
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    finished(npc) {
      npc.getCombat().setPreviousCast(CombatSpells.SARADOMIN_STRIKE);
      npc.getCombat().setCastSpell(null);
    }
  }

  SaradominMethod = class extends CombatMethod {
    constructor() {
      super();
      this.strike = new StrikeMethod();
      this.current = CombatFactory.MELEE_COMBAT;
    }

    /** Picks this attack's style: the wizard counters a protection prayer only when it is in melee range. */
    choose(npc, target) {
      const adjacent = npc.calculateDistance(target) <= 1;
      const style = chooseStyle(adjacent, prays(target, PrayerHandler.PROTECT_FROM_MELEE));
      this.current = style === "melee" ? CombatFactory.MELEE_COMBAT : this.strike;
      return style;
    }

    type() {
      return this.current === this.strike ? CombatType.MAGIC : CombatType.MELEE;
    }

    attackDistance() {
      return ATTACK_DISTANCE;
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    start(npc, target) {
      this.choose(npc, target);
      this.current.start(npc, target);
    }

    hits(npc, target) {
      return this.current.hits(npc, target);
    }

    finished(npc, target) {
      this.current.finished(npc, target);
    }
  };
  return SaradominMethod;
}

function attach(api) {
  core = api.core;
  // Optional so trail tests that stub the plugin API without combat still load.
  api.registerNpcCombatMethodProvider?.([core.NpcIdentifiers.ZAMORAK_WIZARD], methodClass(), { singleton: false });
  api.registerNpcCombatMethodProvider?.([core.NpcIdentifiers.SARADOMIN_WIZARD], saradominMethodClass(), { singleton: false });
}

module.exports = { attach, shout, shoutFor, drainMagic, methodClass, saradominMethodClass, chooseStyle, SHOUTS, FLAMES, FLAMES_MESSAGE };

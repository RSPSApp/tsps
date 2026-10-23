"use strict";

/**
 * Dagannoth Rex's fight (see ../DagannothKings.plugin.js for behaviour and sources).
 *
 * Wiki (Dagannoth Rex): the melee king, max 26, speed 4, weak to magic (magic defence
 * 10 - slashers still hit him, but magic is the safe way from the safespots). Captured
 * walking up to the player and attacking with anim 2853; the 2852 defend and 2856
 * death are shared with the other kings. ReasonPS agrees (2853, speed 4).
 */
const Common = require("./Common.DagannothKings");
const Hud = require("./Hud.DagannothKings");

let RexMethod = null;

function methodClass() {
  if (RexMethod) return RexMethod;
  const { Animation, CombatMethod, CombatType, PendingHit } = Common.core;
  RexMethod = class extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackDistance() {
      // Melee reach on the 3x3 body: edge-adjacent, as captured.
      return 1;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      character.performAnimation(new Animation(Common.ANIM.rexMelee));
      if (target?.isPlayer?.()) Hud.engaged(character, target);
    }

    hits(character, target) {
      return [new PendingHit(character, target, this, Common.HIT_DELAY.rex)];
    }
  };
  return RexMethod;
}

function attach(api) {
  api.registerNpcCombatMethodProvider([Common.REX_ID], methodClass());
}

module.exports = { attach, methodClass };

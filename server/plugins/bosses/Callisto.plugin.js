const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { GraphicHeight } = require("../../src/main/typescript/elvarg/game/model/GraphicHeight");
const { SecondsTimer } = require("../../src/main/typescript/elvarg/game/model/SecondsTimer");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ForceMovementTask } = require("../../src/main/typescript/elvarg/game/task/impl/ForceMovementTask");
const { ForceMovement } = require("../../src/main/typescript/elvarg/game/model/ForceMovement");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

const MELEE_ATTACK_ANIMATION = new Animation(4925);
const END_PROJECTILE_GRAPHIC = new Graphic(359, GraphicHeight.HIGH);

class CallistoCombatMethod extends CombatMethod {
  constructor() {
    super();
    this.comboTimer = new SecondsTimer();
    this.currentAttackType = CombatType.MELEE;
  }

  type() {
    return this.currentAttackType;
  }

  hits(character, target) {
    return [new PendingHit(character, target, this, 2)];
  }

  start(character, target) {
    character.performAnimation(MELEE_ATTACK_ANIMATION);
    if (this.currentAttackType === CombatType.MAGIC) {
      Projectile.createProjectile(
        character,
        target,
        395,
        40,
        60,
        31,
        43
      ).sendProjectile();
    }
  }

  attackDistance() {
    return 4;
  }

  finished(character, target) {
    this.currentAttackType = CombatType.MELEE;
    if (this.comboTimer.finished()) {
      if (Misc.getRandom(10) <= 2) {
        this.comboTimer.start(5);
        this.currentAttackType = CombatType.MAGIC;
        character.getCombat().performNewAttack(true);
      }
    }
  }

  handleAfterHitEffects(hit) {
    if (!hit || !hit.getTarget() || !hit.getTarget().isPlayer()) {
      return;
    }
    const player = hit.getTarget().getAsPlayer();
    if (this.currentAttackType === CombatType.MAGIC) {
      player.performGraphic(END_PROJECTILE_GRAPHIC);
    }
    if (
      !player.getTimers().has(TimerKey.STUN) &&
      Misc.getRandom(100) <= 10
    ) {
      player.performAnimation(new Animation(3131));
      const offsetX = player.getLocation().getX() > 3325 ? -3 : 1 + Misc.getRandom(2);
      const offsetY =
        player.getLocation().getY() > 3834 && player.getLocation().getY() < 3843 ?
          3 :
          -3;
      const toKnock = new Location(offsetX, offsetY);
      TaskManager.submit(
        new ForceMovementTask(
          player,
          3,
          new ForceMovement(
            player.getLocation().clone(),
            toKnock,
            0,
            15,
            0,
            0
          )
        )
      );
      CombatFactory.stun(player, 4, false);
    }
  }
}

let CombatFactory;
let TaskManager;

module.exports = {
  name: "Callisto",
  members: true,
  register(api) {
    CombatFactory = api.getCombatFactory();
    TaskManager = api.getTaskManager();
    api.registerNpcCombatMethodProvider(
      [NpcIdentifiers.CALLISTO],
      CallistoCombatMethod,
      { singleton: false }
    );
  },
};

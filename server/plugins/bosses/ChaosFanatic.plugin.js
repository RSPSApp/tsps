const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { GraphicHeight } = require("../../src/main/typescript/elvarg/game/model/GraphicHeight");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

class ChaosTask extends Task {
  constructor(delay, execFunc, target, registered) {
    super(delay, target, registered);
    this.execFunc = execFunc;
  }

  execute() {
    this.execFunc();
    this.stop();
  }
}

const Attack = {
  SPECIAL_ATTACK: 0,
  DEFAULT_MAGIC_ATTACK: 1,
};

const QUOTES = [
  "Burn!",
  "WEUGH!",
  "Develish Oxen Roll!",
  "All your wilderness are belong to them!",
  "AhehHeheuhHhahueHuUEehEahAH",
  "I shall call him squidgy and he shall be my squidgy!",
];

const ATTACK_END_GFX = new Graphic(305, GraphicHeight.HIGH);
const EXPLOSION_END_GFX = new Graphic(157, GraphicHeight.MIDDLE);
const MAGIC_ATTACK_ANIM = new Animation(811);

function disarmPlayer(player) {
  if (!player.getInventory().isFull()) {
    const randomSlot = Misc.getRandom(player.getEquipment().capacity() - 1);
    const toDisarm = player.getEquipment().getItems()[randomSlot];
    if (toDisarm.isValid()) {
      player.getEquipment().set(randomSlot, new Item(-1, 0));
      player.getInventory().addItem(toDisarm.clone());
      player.sendMessage("You have been disarmed!");
      WeaponInterfaceManager.assign(player);
      BonusManager.update(player);
      player.getUpdateFlag().flag(Flag.APPEARANCE);
    }
  }
}

class ChaosFanaticCombatMethod extends CombatMethod {
  constructor() {
    super();
    this.attack = Attack.DEFAULT_MAGIC_ATTACK;
  }

  hits(character, target) {
    if (this.attack === Attack.SPECIAL_ATTACK) {
      return null;
    }
    return [new PendingHit(character, target, this, 2)];
  }

  start(character, target) {
    if (!character?.isNpc?.() || !target?.isPlayer?.()) {
      return;
    }
    character.performAnimation(MAGIC_ATTACK_ANIM);
    this.attack = Attack.DEFAULT_MAGIC_ATTACK;
    if (Misc.getRandom(9) < 3) {
      this.attack = Attack.SPECIAL_ATTACK;
    }
    character.forceChat(QUOTES[Misc.getRandom(QUOTES.length - 1)]);
    if (this.attack === Attack.DEFAULT_MAGIC_ATTACK) {
      const projectile = Projectile.createProjectile(character, target, 554, 62, 80, 31, 43);
      projectile.sendProjectile();
      if (Misc.getRandom(1) === 0) {
        TaskManager.submit(
          new ChaosTask(3, () => target.performGraphic(ATTACK_END_GFX), target, false)
        );
      }
    } else if (this.attack === Attack.SPECIAL_ATTACK) {
      const targetPos = target.getLocation();
      const attackPositions = [targetPos];
      for (let i = 0; i < 3; i++) {
        attackPositions.push(
          new Location(
            targetPos.getX() - 1 + Misc.getRandom(3),
            targetPos.getY() - 1 + Misc.getRandom(3)
          )
        );
      }
      for (const pos of attackPositions) {
        new Projectile(
          character.getLocation(),
          pos,
          null,
          551,
          40,
          80,
          31,
          43,
          character.getPrivateArea()
        ).sendProjectile();
      }
      TaskManager.submit(
        new ChaosTask(
          4,
      () => {
            for (const pos of attackPositions) {
              target
                .getAsPlayer()
                .getPacketSender()
                .sendGlobalGraphic(EXPLOSION_END_GFX, pos);
              for (const splashPlayer of character.getAsNpc().getPlayersWithinDistance(10)) {
                if (splashPlayer.getLocation().equals(pos)) {
                  splashPlayer
                    .getCombat()
                    .getHitQueue()
                    .addPendingDamage([
                      new HitDamage(Misc.getRandom(25), HitMask.RED),
                    ]);
                }
              }
            }
            this.finished(character, target);
          },
          target,
          false
        )
      );
      character.getCombat().setAttackDelay(5);
    }
  }

  attackDistance() {
    return 8;
  }

  finished(character, target) {
    if (Misc.getRandom(10) !== 1) {
      return;
    }
    if (target.isPlayer()) {
      disarmPlayer(target.getAsPlayer());
    }
  }

  type() {
    return CombatType.MAGIC;
  }
}

let TaskManager;
let BonusManager;

module.exports = {
  name: "ChaosFanatic",
  members: true,
  register(api) {
    TaskManager = api.getTaskManager();
    BonusManager = api.getBonusManager();
    api.registerNpcCombatMethodProvider(
      [NpcIdentifiers.CHAOS_FANATIC],
      ChaosFanaticCombatMethod,
      { singleton: false }
    );
  },
};

const QUOTES = [
  "I'm Bellock - respect me!",
  "Get off my site!",
  "No-one messes with Bellock's dig!",
  "These ruins are mine!",
  "Taste my knowledge!",
  "You belong in a museum!",
];

const Attack = {
  SPECIAL_ATTACK: 0,
  DEFAULT_RANGED_ATTACK: 1,
  DEFAULT_MELEE_ATTACK: 2,
};

let TaskManager;

/** The combat method, built on api.core's classes. */
function combatClass(api) {
  TaskManager = api.getTaskManager();
  const { Animation, CombatMethod, CombatType, Graphic, GraphicHeight, HitDamage, HitMask, Location, Misc, PendingHit, Projectile, Task } = api.core;
  const RANGED_END_GFX = new Graphic(305, GraphicHeight.HIGH);
  const RAIN_START_GFX = new Graphic(157, GraphicHeight.MIDDLE);
  const MELEE_ATTACK_ANIM = new Animation(423);
  const RANGED_ATTACK_ANIM = new Animation(3353);

  class CrazyTask extends Task {
    constructor(delay, execFunc, target, registered) {
      super(delay, target, registered);
      this.execFunc = execFunc;
    }

    execute() {
      this.execFunc();
      this.stop();
    }
  }

  class CrazyArchaeologistCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.attack = Attack.DEFAULT_RANGED_ATTACK;
    }

    hits(character, target) {
      if (this.attack === Attack.SPECIAL_ATTACK) {
        return [];
      }
      const delay = this.attack === Attack.DEFAULT_MELEE_ATTACK ? 0 : this.landing ?? 2;
      return [new PendingHit(character, target, this, delay)];
    }

    start(character, target) {
      if (!character || !target) {
        return;
      }
      this.attack = Attack.DEFAULT_RANGED_ATTACK;
      if (
        target.getLocation().getDistance(character.getLocation()) < 2 &&
        Misc.getRandom(1) === 0
      ) {
        this.attack = Attack.DEFAULT_MELEE_ATTACK;
      }
      if (Misc.getRandom(10) < 3) {
        this.attack = Attack.SPECIAL_ATTACK;
      }
      character.forceChat(
        QUOTES[Misc.getRandom(QUOTES.length - 1)]
      );

      if (this.attack === Attack.DEFAULT_RANGED_ATTACK) {
        character.performAnimation(RANGED_ATTACK_ANIM);
        // A thrown book: 5 cycles a tile instead of a flat 65, with the impact and the
        // hit on the tick it lands (#1862).
        const end = Projectile.arrivalCycles(character, target, 45, 5);
        this.landing = Projectile.ticksToLand(end);
        const projectile = Projectile.createProjectile(
          character,
          target,
          1259,
          40,
          end,
          31,
          43
        );
        projectile.sendProjectile();
        TaskManager.submit(
          new CrazyTask(
            this.landing,
            () => {
              target.performGraphic(RANGED_END_GFX);
            },
            target,
            false
          )
        );
      } else if (this.attack === Attack.SPECIAL_ATTACK) {
        character.performAnimation(RANGED_ATTACK_ANIM);
        character.forceChat("Rain of Knowledge!");
        const targetPos = target.getLocation();
        const attackPositions = [targetPos];
        for (let i = 0; i < 2; i++) {
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
            1260,
            40,
            80,
            31,
            43,
            character.getPrivateArea()
          ).sendProjectile();
        }
        TaskManager.submit(
          new CrazyTask(
            4,
            () => {
              for (const pos of attackPositions) {
                target
                  .getAsPlayer()
                  .getPacketSender()
                  .sendGlobalGraphic(RAIN_START_GFX, pos);
                const players = character
                  .getAsNpc()
                  .getPlayersWithinDistance(10);
                for (const player of players) {
                  if (player.getLocation().equals(pos)) {
                    player
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
      } else if (this.attack === Attack.DEFAULT_MELEE_ATTACK) {
        character.performAnimation(MELEE_ATTACK_ANIM);
      }
    }

    attackSpeed(character) {
      if (this.attack === Attack.DEFAULT_MELEE_ATTACK) {
        return 3;
      }
      return super.attackSpeed(character);
    }

    attackDistance() {
      if (this.attack === Attack.DEFAULT_MELEE_ATTACK) {
        return 1;
      }
      if (this.attack === Attack.SPECIAL_ATTACK) {
        return 8;
      }
      return 6;
    }

    type() {
      if (this.attack === Attack.DEFAULT_MELEE_ATTACK) {
        return CombatType.MELEE;
      }
      return CombatType.RANGED;
    }
  }

  return CrazyArchaeologistCombatMethod;
}

module.exports = {
  name: "CrazyArchaeologist",
  members: true,
  register(api) {
    api.registerNpcCombatMethodProvider(
      [api.core.NpcIdentifiers.CRAZY_ARCHAEOLOGIST],
      combatClass(api),
      { singleton: false }
    );
  },
};

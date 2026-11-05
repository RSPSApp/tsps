const Attack = {
  EXPLOSION: 0,
  DISARM: 1,
  DEFAULT_MAGIC_ATTACK: 2,
};

/**
 * The three outcomes of his attack roll (Wiki: Chaos Fanatic, "Fight overview"): at the start of
 * the fight, and again once the explosion's cooldown has run out, 10/15 a standard red attack,
 * 4/15 the explosion and 1/15 the disarming projectile.
 */
const SPECIAL_ROLLS = 15;
const EXPLOSION_ROLL = 10;
const DISARM_ROLL = 14;

/** The explosion is "always followed by a 12-attack cooldown" (Wiki) - 24 ticks at speed 2. */
const EXPLOSION_COOLDOWN_ATTACKS = 12;

/** Both specials are green projectiles that land four ticks after the cast (Wiki; the spell's gfx). */
const SPECIAL_LANDING_TICKS = 4;
const SPECIAL_PROJECTILE = 551;
/** The explosion's max hit is 31 (Wiki infobox: "21 (Magic attack), 31 (Special attack)"). */
const EXPLOSION_MAX_HIT = 31;

/** How many of his attacks still have to be standard before he may roll a special. */
const COOLDOWN_ATTRIBUTE = "chaos-fanatic:cooldown-attacks";

/** The NPC's own transcript lines (data/definitions/npc-dialogues.json, "when-attacking-the-player"). */
const QUOTES = [
  "BURN!",
  "WEUGH!",
  "Devilish Oxen Roll!!",
  "All your wilderness are belong to them!",
  "AhehHeheuhHhahueHuUEehEahAH!",
  "I shall call him squidgy and he shall be my squidgy!!",
];

/** Core classes, from api.core when the combat method is built. */
let CombatType, Flag, HitDamage, HitMask, Item, Location, Misc, PendingHit, Projectile, WeaponInterfaceManager;
let TaskManager;
let BonusManager;

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

/**
 * What he throws next: `cooldown` attacks of standard red attacks after an explosion, otherwise
 * the 10/15 - 4/15 - 1/15 roll. `roll` is 0..14, as Misc.getRandom(14) gives.
 */
function chooseAttack(cooldown, roll) {
  if (cooldown > 0) {
    return { attack: Attack.DEFAULT_MAGIC_ATTACK, cooldown: cooldown - 1 };
  }
  if (roll < EXPLOSION_ROLL) {
    return { attack: Attack.DEFAULT_MAGIC_ATTACK, cooldown: 0 };
  }
  if (roll < DISARM_ROLL) {
    return { attack: Attack.EXPLOSION, cooldown: EXPLOSION_COOLDOWN_ATTACKS };
  }
  return { attack: Attack.DISARM, cooldown: 0 };
}

/** The player's tile plus two of the eight around it: three books, never the same tile twice. */
function explosionTiles(centre, random) {
  const around = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      around.push([centre.getX() + dx, centre.getY() + dy]);
    }
  }
  const chosen = [];
  while (chosen.length < 2 && around.length > 0) {
    chosen.push(around.splice(random(around.length - 1), 1)[0]);
  }
  return [[centre.getX(), centre.getY()], ...chosen];
}

/** The combat method, built on api.core's classes. */
function combatClass(api) {
  ({ CombatType, Flag, HitDamage, HitMask, Item, Location, Misc, PendingHit, Projectile, WeaponInterfaceManager } = api.core);
  TaskManager = api.getTaskManager();
  BonusManager = api.getBonusManager();
  const { Animation, CombatMethod, Graphic, GraphicHeight, Task } = api.core;
  const ATTACK_END_GFX = new Graphic(305, GraphicHeight.HIGH);
  const EXPLOSION_END_GFX = new Graphic(157, GraphicHeight.MIDDLE);
  const MAGIC_ATTACK_ANIM = new Animation(811);

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

  class ChaosFanaticCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.attack = Attack.DEFAULT_MAGIC_ATTACK;
    }

    hits(character, target) {
      if (this.attack !== Attack.DEFAULT_MAGIC_ATTACK) {
        return null;
      }
      return [new PendingHit(character, target, this, this.landing ?? 2)];
    }

    start(character, target) {
      if (!character?.isNpc?.() || !target?.isPlayer?.()) {
        return;
      }
      const npc = character.getAsNpc();
      const next = chooseAttack(npc.getAttribute?.(COOLDOWN_ATTRIBUTE) ?? 0, Misc.getRandom(SPECIAL_ROLLS - 1));
      this.attack = next.attack;
      npc.setAttribute?.(COOLDOWN_ATTRIBUTE, next.cooldown);

      character.performAnimation(MAGIC_ATTACK_ANIM);
      character.forceChat(QUOTES[Misc.getRandom(QUOTES.length - 1)]);

      if (this.attack === Attack.DEFAULT_MAGIC_ATTACK) {
        // 10 cycles a tile over his 8-tile reach instead of a flat 80; the hit and the
        // impact land on the tick the blast does (#1862).
        const end = Projectile.arrivalCycles(character, target, 67, 10);
        this.landing = Projectile.ticksToLand(end);
        const projectile = Projectile.createProjectile(character, target, 554, 62, end, 31, 43);
        projectile.sendProjectile();
        if (Misc.getRandom(1) === 0) {
          TaskManager.submit(
            new ChaosTask(this.landing, () => target.performGraphic(ATTACK_END_GFX), target, false)
          );
        }
      } else if (this.attack === Attack.EXPLOSION) {
        this.explode(character, target);
      } else {
        this.disarm(character, target);
      }
    }

    /** Three green projectiles: the player's tile, which he always aims at, and two around it. */
    explode(character, target) {
      const tiles = explosionTiles(target.getLocation(), (max) => Misc.getRandom(max));
      for (const [x, y] of tiles) {
        new Projectile(
          character.getLocation(),
          new Location(x, y, target.getLocation().getZ()),
          null,
          SPECIAL_PROJECTILE,
          40,
          80,
          31,
          43,
          character.getPrivateArea()
        ).sendProjectile();
      }
      TaskManager.submit(
        new ChaosTask(
          SPECIAL_LANDING_TICKS,
          () => {
            const npc = character.getAsNpc();
            for (const [x, y] of tiles) {
              const pos = new Location(x, y, target.getLocation().getZ());
              target.getPacketSender().sendGlobalGraphic(EXPLOSION_END_GFX, pos);
              for (const splashPlayer of npc.getPlayersWithinDistance(10)) {
                if (splashPlayer.getLocation().equals(pos)) {
                  splashPlayer
                    .getCombat()
                    .getHitQueue()
                    .addPendingDamage([new HitDamage(Misc.getRandom(EXPLOSION_MAX_HIT), HitMask.RED)]);
                }
              }
            }
          },
          target,
          false
        )
      );
      character.getCombat().setAttackDelay(5);
    }

    /** The unavoidable green projectile that disarms (Wiki); a full inventory leaves nothing to take. */
    disarm(character, target) {
      new Projectile(
        character.getLocation(),
        target.getLocation(),
        target,
        SPECIAL_PROJECTILE,
        40,
        80,
        31,
        43,
        character.getPrivateArea()
      ).sendProjectile();
      TaskManager.submit(
        new ChaosTask(SPECIAL_LANDING_TICKS, () => disarmPlayer(target.getAsPlayer()), target, false)
      );
    }

    attackDistance() {
      return 8;
    }

    type() {
      return CombatType.MAGIC;
    }
  }

  return ChaosFanaticCombatMethod;
}

module.exports = {
  name: "ChaosFanatic",
  members: true,
  register(api) {
    api.registerNpcCombatMethodProvider(
      [api.core.NpcIdentifiers.CHAOS_FANATIC],
      combatClass(api),
      { singleton: false }
    );
  },
  _test: {
    Attack, chooseAttack, explosionTiles, combatClass, COOLDOWN_ATTRIBUTE, QUOTES,
    EXPLOSION_MAX_HIT, EXPLOSION_COOLDOWN_ATTACKS, SPECIAL_ROLLS,
  },
};

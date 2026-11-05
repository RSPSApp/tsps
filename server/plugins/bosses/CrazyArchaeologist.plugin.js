const QUOTES = [
  "You belong in a museum!",
  "I'm Bellock - respect me!",
  "Get off my site!",
  "These ruins are mine!",
  "Taste my knowledge!",
  "No-one messes with Bellock's dig!",
];

/** His transcript lines (data/definitions/npc-dialogues.json): the special's shout and his death. */
const SPECIAL_SHOUT = "Rain of knowledge!";
const DEATH_LINE = "Ow!";

const Attack = {
  SPECIAL_ATTACK: 0,
  DEFAULT_RANGED_ATTACK: 1,
  DEFAULT_MELEE_ATTACK: 2,
};

/** The books explode four ticks after the shout (the spell's own delay). */
const SPECIAL_IMPACT_TICKS = 4;
/** One book splits and its two books explode "after a delay" (Wiki); the length is an approximation. */
const BURST_IMPACT_TICKS = 2;
/** The two other books land beside the player's tile (the Wiki gives no radius). */
const SPECIAL_SCATTER_RADIUS = 1;
/** "24 (special)" (Wiki infobox); the standard attack's 14 comes from the NPC's definition. */
const SPECIAL_MAX_HIT = 24;

let TaskManager;
let core;

const tileKey = (tile) => `${tile.x},${tile.y}`;

/**
 * Distinct tiles within the 3x3 around `centre`, never reusing `taken` or the centre.
 * `random(n)` returns 0..n like Misc.getRandom, so tests can pass a stub.
 */
function scatterTiles(centre, count, taken, random) {
  const seen = new Set(taken.map(tileKey));
  seen.add(tileKey(centre));
  const tiles = [];
  for (let guard = 0; tiles.length < count && guard < 50; guard++) {
    const tile = {
      x: centre.x + random(SPECIAL_SCATTER_RADIUS * 2) - SPECIAL_SCATTER_RADIUS,
      y: centre.y + random(SPECIAL_SCATTER_RADIUS * 2) - SPECIAL_SCATTER_RADIUS,
    };
    if (seen.has(tileKey(tile))) continue;
    seen.add(tileKey(tile));
    tiles.push(tile);
  }
  return tiles;
}

/** The opening volley: the player's tile plus two scattered books, all distinct. */
function initialSpecialTiles(centre, random) {
  return [{ x: centre.x, y: centre.y }, ...scatterTiles(centre, 2, [], random)];
}

/** The two books the centre one splits into on impact. */
function burstSpecialTiles(centre, opened, random) {
  return scatterTiles(centre, 2, opened, random);
}

/** A book's explosion covers the 3x3 centred on where it lands (Wiki). */
function coversTile(book, tile) {
  return Math.max(Math.abs(book.x - tile.x), Math.abs(book.y - tile.y)) <= 1;
}

/** The combat method, built on api.core's classes. */
function combatClass(api) {
  TaskManager = api.getTaskManager();
  core = api.core;
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
        this.rainOfKnowledge(character, target);
      } else if (this.attack === Attack.DEFAULT_MELEE_ATTACK) {
        character.performAnimation(MELEE_ATTACK_ANIM);
      }
    }

    /**
     * Three books: the player's tile, which one always targets, and two around it. Each explodes
     * over a 3x3 area (Wiki); the centre one then splits into two more books "after a delay".
     */
    rainOfKnowledge(character, target) {
      character.performAnimation(RANGED_ATTACK_ANIM);
      character.forceChat(SPECIAL_SHOUT);
      const tile = target.getLocation();
      const centre = { x: tile.getX(), y: tile.getY() };
      const z = tile.getZ();
      const opened = initialSpecialTiles(centre, (max) => Misc.getRandom(max));
      this.throwBooks(character, opened, z);
      TaskManager.submit(
        new CrazyTask(
          SPECIAL_IMPACT_TICKS,
          () => {
            this.explodeBooks(character, target, opened, z);
            const burst = burstSpecialTiles(centre, opened, (max) => Misc.getRandom(max));
            this.throwBooks(character, burst, z);
            TaskManager.submit(
              new CrazyTask(
                BURST_IMPACT_TICKS,
                () => this.explodeBooks(character, target, burst, z),
                target,
                false
              )
            );
          },
          target,
          false
        )
      );
      character.getCombat().setAttackDelay(5);
    }

    throwBooks(character, tiles, z) {
      for (const book of tiles) {
        new Projectile(
          character.getLocation(),
          new Location(book.x, book.y, z),
          null,
          1260,
          40,
          80,
          31,
          43,
          character.getPrivateArea()
        ).sendProjectile();
      }
    }

    /** One roll per book, taken by everyone standing in its 3x3 (the Wiki gives no falloff). */
    explodeBooks(character, target, tiles, z) {
      const npc = character.getAsNpc();
      const players = npc.getPlayersWithinDistance(10);
      for (const book of tiles) {
        target
          .getPacketSender()
          .sendGlobalGraphic(RAIN_START_GFX, new Location(book.x, book.y, z));
        const damage = Misc.getRandom(SPECIAL_MAX_HIT);
        for (const player of players) {
          if (coversTile(book, player.getLocation())) {
            player
              .getCombat()
              .getHitQueue()
              .addPendingDamage([new HitDamage(damage, HitMask.RED)]);
          }
        }
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

/** His death line (the Wiki's transcript: "Ow!"). */
function crazyDeath({ npc }) {
  if (!npc || typeof npc.getId !== "function") return;
  if (npc.getId() !== core.NpcIdentifiers.CRAZY_ARCHAEOLOGIST) return;
  npc.forceChat(DEATH_LINE);
}

function attachCombat(api) {
  core = api.core;
  api.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.CRAZY_ARCHAEOLOGIST],
    combatClass(api),
    { singleton: false }
  );
}

module.exports = {
  name: "CrazyArchaeologist",
  members: true,
  register(api) {
    attachCombat(api);
    api.onNpcBeforeDeath(crazyDeath);
  },
  _test: {
    Attack, combatClass, scatterTiles, initialSpecialTiles, burstSpecialTiles, coversTile,
    SPECIAL_MAX_HIT, SPECIAL_SHOUT, DEATH_LINE,
  },
};

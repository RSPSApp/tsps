"use strict";

/**
 * The Deranged archaeologist (https://oldschool.runescape.wiki/w/Deranged_archaeologist),
 * south end of the Tar Swamp on Fossil Island: melee up close, ranged books at distance,
 * and the "Learn to Read!" exploding-book special. Near-Reality's
 * DerangedArchaeologist.java was used only as a behavior oracle and every mechanic below
 * was checked against the Wiki (Deranged archaeologist + Strategies, incl. Mod Ash's
 * 1/3 chance, 25-tick cooldown and 56/18 figures), so the RSPS code is never the
 * justification.
 *
 * Ids follow the Crazy archaeologist, whose plugin is the template: the book throw uses
 * anim 3353 with projectiles 1259/1260 and ground gfx 157/305. Melee is 425, the only
 * other observed anim on 7806 (npc-animations.json lists [425, 3353, 836]; 836 is the
 * death anim). Quotes are the NPC's own transcript lines (npc-dialogues.json), including
 * the "Oh!" death line.
 */
const MELEE_ANIMATION = 425;
const RANGED_ANIMATION = 3353;
const BOOK_PROJECTILE = 1259;
const SPECIAL_PROJECTILE = 1260;
const RANGED_IMPACT_GFX = 305;
const SPECIAL_IMPACT_GFX = 157;

const SPECIAL_SHOUT = "Learn to Read!";
const DEATH_LINE = "Oh!";
const AMBIENT_LINES = [
  "Round and round and round and round!",
  "The plants! They're alive!",
  "They came from the ground! They came from the ground!!!",
  "The doors won't stay closed forever!",
  "They're cheering! Why are they cheering?",
  "Time is running out! She will rise again!!!",
];

/** 25-tick internal cooldown and a 1/3 chance per attack (Wiki Strategies). */
const SPECIAL_COOLDOWN_TICKS = 25;
/** Books explode four ticks after the shout (Wiki Strategies). */
const SPECIAL_IMPACT_DELAY_TICKS = 4;
/** The burst books follow "after another delay" (Wiki); length is an approximation. */
const SPECIAL_BURST_DELAY_TICKS = 2;
/** Direct hits up to 56, adjacent tiles up to 18; defence and prayers ignored (Wiki). */
const SPECIAL_DIRECT_MAX = 56;
const SPECIAL_SPLASH_MAX = 18;
/** Side books land in the 5x5 around the target tile (Wiki; the rare 9x9 outliers aren't modeled). */
const SPECIAL_SCATTER_RADIUS = 2;

/** Ready-cycle of the special, kept on the NPC: the combat method is rebuilt every
 * attack, so instance fields do not survive between swings. */
const SPECIAL_READY_ATTRIBUTE = "deranged-archaeologist:special-ready-cycle";

const Attack = {
  SPECIAL: 0,
  RANGED: 1,
  MELEE: 2,
};

const tileKey = (tile) => `${tile.x},${tile.y}`;

/**
 * Distinct scatter tiles around `centre` within the 5x5, never reusing `taken`.
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

/** The burst from the central impact: two more books, distinct from the opening volley. */
function burstSpecialTiles(centre, opened, random) {
  return scatterTiles(centre, 2, opened, random);
}

/** Melee only when adjacent (diagonals count); otherwise the special or the ranged book. */
function chooseAttack({ adjacent, specialReady, specialRoll }) {
  if (adjacent) return Attack.MELEE;
  if (specialReady && specialRoll === 0) return Attack.SPECIAL;
  return Attack.RANGED;
}

/** Rolled damage for one explosion tile: full on it, reduced adjacent, none further out. */
function explosionDamage(explosion, playerTile, rollMax) {
  const distance = Math.max(Math.abs(explosion.x - playerTile.x), Math.abs(explosion.y - playerTile.y));
  if (distance === 0) return rollMax(SPECIAL_DIRECT_MAX);
  if (distance === 1) return rollMax(SPECIAL_SPLASH_MAX);
  return 0;
}

let core;

function attachCombat(api) {
  core = api.core;
  api.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.DERANGED_ARCHAEOLOGIST],
    combatClass(core),
    { singleton: false },
  );
}

function combatClass(apiCore) {
  const {
    Animation, CombatMethod, CombatType, Graphic, GraphicHeight, HitDamage, HitMask,
    Location, Misc, PendingHit, Projectile, Task, TaskManager, World,
  } = apiCore;
  const MELEE_ANIM = new Animation(MELEE_ANIMATION);
  const RANGED_ANIM = new Animation(RANGED_ANIMATION);
  const RANGED_GFX = new Graphic(RANGED_IMPACT_GFX, GraphicHeight.HIGH);
  const SPECIAL_GFX = new Graphic(SPECIAL_IMPACT_GFX, GraphicHeight.MIDDLE);

  class DelayedTask extends Task {
    constructor(delay, execFunc, target, registered) {
      super(delay, target, registered);
      this.execFunc = execFunc;
    }

    execute() {
      this.execFunc();
      this.stop();
    }
  }

  function afterTicks(ticks, target, execFunc) {
    TaskManager.submit(new DelayedTask(ticks, execFunc, target, false));
  }

  function sendTileProjectile(npc, from, tile, z) {
    new Projectile(
      from,
      new Location(tile.x, tile.y, z),
      null,
      SPECIAL_PROJECTILE,
      40,
      80,
      31,
      43,
      npc.getPrivateArea(),
    ).sendProjectile();
  }

  function explodeTiles(npc, tiles) {
    const viewers = npc.getPlayersWithinDistance(12);
    for (const tile of tiles) {
      const at = new Location(tile.x, tile.y, npc.getLocation().getZ());
      for (const viewer of viewers) {
        viewer.getPacketSender().sendGlobalGraphic(SPECIAL_GFX, at);
      }
    }
    for (const tile of tiles) {
      for (const viewer of viewers) {
        const position = viewer.getLocation();
        const damage = explosionDamage(tile, { x: position.getX(), y: position.getY() },
          (max) => Misc.getRandom(max));
        if (damage > 0) {
          viewer.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
        }
      }
    }
  }

  function fireSpecial(npc, target) {
    npc.performAnimation(RANGED_ANIM);
    npc.forceChat(SPECIAL_SHOUT);
    const targetTile = target.getLocation();
    const centre = { x: targetTile.getX(), y: targetTile.getY() };
    const opened = initialSpecialTiles(centre, (n) => Misc.getRandom(n));
    for (const tile of opened) {
      sendTileProjectile(npc, npc.getLocation(), tile, targetTile.getZ());
    }
    afterTicks(SPECIAL_IMPACT_DELAY_TICKS, target, () => {
      explodeTiles(npc, opened);
      const burst = burstSpecialTiles(centre, opened, (n) => Misc.getRandom(n));
      for (const tile of burst) {
        sendTileProjectile(npc, new Location(centre.x, centre.y, targetTile.getZ()), tile, targetTile.getZ());
      }
      afterTicks(SPECIAL_BURST_DELAY_TICKS, target, () => explodeTiles(npc, burst));
    });
    npc.getCombat().setAttackDelay(5);
  }

  function fireRanged(npc, target) {
    npc.performAnimation(RANGED_ANIM);
    npc.forceChat(AMBIENT_LINES[Misc.getRandom(AMBIENT_LINES.length - 1)]);
    Projectile.createProjectile(npc, target, BOOK_PROJECTILE, 40, 65, 31, 43).sendProjectile();
    afterTicks(3, target, () => target.performGraphic(RANGED_GFX));
  }

  function fireMelee(npc) {
    npc.performAnimation(MELEE_ANIM);
    npc.forceChat(AMBIENT_LINES[Misc.getRandom(AMBIENT_LINES.length - 1)]);
  }

  return class DerangedArchaeologistCombat extends CombatMethod {
    hits(character, target) {
      if (this.attack === Attack.SPECIAL) return [];
      return [new PendingHit(character, target, this, this.attack === Attack.MELEE ? 0 : 2)];
    }

    start(character, target) {
      if (!character || !target) return;
      const npc = character.getAsNpc();
      const adjacent = target.getLocation().getDistance(character.getLocation()) < 2;
      const specialReady = World.getProcessCycle() >= (npc.getAttribute(SPECIAL_READY_ATTRIBUTE) ?? 0);
      this.attack = chooseAttack({ adjacent, specialReady, specialRoll: Misc.getRandom(2) });
      if (this.attack === Attack.MELEE) {
        fireMelee(character);
      } else if (this.attack === Attack.SPECIAL) {
        npc.setAttribute(SPECIAL_READY_ATTRIBUTE, World.getProcessCycle() + SPECIAL_COOLDOWN_TICKS);
        fireSpecial(npc, target);
      } else {
        fireRanged(character, target);
      }
    }

    attackDistance() {
      if (this.attack === Attack.MELEE) return 1;
      return 10;
    }

    type() {
      if (this.attack === Attack.MELEE) return CombatType.MELEE;
      return CombatType.RANGED;
    }
  };
}

function derangedDeath({ npc }) {
  if (!npc || typeof npc.getId !== "function") return;
  if (npc.getId() !== core.NpcIdentifiers.DERANGED_ARCHAEOLOGIST) return;
  npc.forceChat(DEATH_LINE);
}

module.exports = {
  name: "DerangedArchaeologist",
  members: true,
  register(api) {
    attachCombat(api);
    api.onNpcDeath(derangedDeath);
  },
  _test: { chooseAttack, combatClass, scatterTiles, initialSpecialTiles, burstSpecialTiles, explosionDamage, Attack },
};

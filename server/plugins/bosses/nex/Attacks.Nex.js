/**
 * Nex's standard attacks (docs/nex.md):
 * - Wiki: melee (max 27) when her target stands beside her, always three in a row while they stay
 *   there, and never a fourth; otherwise the phase's spell. Smoke, ice and Zaros magic (max 33)
 *   and shadow shots (ranged, up to 60, less further away) hit everyone; the blood barrage hits her
 *   target and anyone beside them, healing her a quarter. Protection prayers block 80% of her
 *   melee (two thirds in the Zaros phase) and half her magic and ranged; against Zaros magic,
 *   raising the prayer after she cast blocks a quarter.
 * - Captured: each style's animation, sound, projectile (from 46 cycles at 10 a tile, angle 5,
 *   progress 84), impact graphic and sound, a splash on a miss, and the blood heal a tick after it.
 * - Zaros phase: Soul Split heals her a share of each hit (captured: a projectile from the player
 *   back to her); her melee can carry Turmoil (captured: 23 of about 100 melee hits).
 */
const Common = require("./Common.Nex");

function drainPrayer(player, amount) {
  if (amount <= 0) return;
  const apply = Common.core.applyPrayerDrainModifiers;
  if (typeof apply === "function") amount = apply(player, amount, { source: "nex" });
  if (amount > 0) player.getSkillManager().decreaseCurrentLevel(Common.core.Skill.PRAYER, amount, 0);
}

/** Next to her body on a side, not at a corner diagonal. */
function inMeleeReach(fight, player) {
  if (fight.distanceTo(player) !== 1) return false;
  const at = player.getLocation();
  const base = fight.boss.getLocation();
  const alongX = at.getX() >= base.getX() && at.getX() < base.getX() + 3;
  const alongY = at.getY() >= base.getY() && at.getY() < base.getY() + 3;
  return alongX || alongY;
}

/** Her attack on `target`; false when she can't reach them this turn. */
function attack(fight, target) {
  const { fight: data } = Common.data;
  if (!target || target.getHitpoints() <= 0) return false;
  const distance = fight.distanceTo(target);
  if (distance === 0 || distance > data.magicRange) return false;
  if (inMeleeReach(fight, target) && !fight.noMeleeNext) {
    melee(fight, target);
    fight.meleeChain++;
    if (fight.meleeChain >= data.meleeChain) {
      fight.meleeChain = 0;
      fight.noMeleeNext = true;
    }
    return true;
  }
  fight.meleeChain = 0;
  fight.noMeleeNext = false;
  if (fight.phase().key === "blood") blood(fight, target);
  else spell(fight, target);
  return true;
}

function melee(fight, target) {
  const { fight: data } = Common.data;
  fight.boss.performAnimation(Common.animation(data.attacks.melee.anim));
  const blocked = fight.phase().key === "zaros" ? 2 / 3 : 0.8;
  Common.strike(fight.boss, target, "melee", data.meleeMax, 0, {
    prayed: (style) => (style === "melee" ? 1 - blocked : 1),
    landed: (damage) => {
      fight.noteHit(target, "melee", damage);
      zarosHit(fight, target, damage, true);
    },
  });
}

/** Smoke, shadow, ice or Zaros: a projectile at everyone, each landing on its own. */
function spell(fight, target) {
  const { fight: data } = Common.data;
  const key = fight.phase().key;
  const style = data.attacks[key];
  fight.boss.performAnimation(Common.animation(style.anim));
  fight.areaSound(style.sound);
  const kind = key === "shadow" ? "ranged" : "magic";
  const drag = key === "smoke" ? require("./Specials.Nex").dragCandidate(fight) : null;
  for (const player of fight.players()) {
    if (player.getHitpoints() <= 0) continue;
    const cycles = Common.projectile(fight.boss, player, {
      ...style.projectile,
      start: data.attacks.projectileStart,
      angle: data.attacks.projectileAngle,
      progress: data.attacks.projectileProgress,
    });
    const prayedAtCast = Common.protectedStyle(player) === kind;
    const max = key === "shadow" ? shadowMax(fight, player) : data.magicMax;
    Common.strike(fight.boss, player, kind, max, Common.landsIn(cycles), {
      prayed: (prayer) => {
        if (prayer !== kind) return 1;
        return key === "zaros" && !prayedAtCast ? 0.75 : 0.5;
      },
      landed: (damage, accurate) => {
        landed(fight, key, player, damage, accurate);
        if (player === drag) require("./Specials.Nex").drag(fight, player);
      },
    });
  }
}

/** Wiki: shadow shots hurt more the closer you stand. */
function shadowMax(fight, player) {
  const { magicRange, shadowMax: max } = Common.data.fight;
  const distance = Math.max(1, Math.min(magicRange, fight.distanceTo(player)));
  return Math.round(max - ((distance - 1) * (max - 2)) / (magicRange - 1));
}

function landed(fight, key, player, damage, accurate) {
  const { fight: data } = Common.data;
  const style = data.attacks[key];
  const sender = player.getPacketSender();
  if (!accurate && key !== "shadow") {
    player.performGraphic(Common.graphic(data.attacks.splash.graphic, { height: data.attacks.splash.height }));
    sender.sendSoundEffect(data.attacks.splash.sound, 1, 0);
    return;
  }
  if (style.impact > 0) player.performGraphic(Common.graphic(style.impact, { height: style.impactHeight }));
  sender.sendSoundEffect(style.impactSound, 1, 0);
  fight.noteHit(player, key, damage);
  if (damage <= 0) return;
  if (key === "smoke") {
    Common.core.CombatFactory.poisonEntity(player, data.poisonSeverity, 1);
  } else if (key === "shadow") {
    drainPrayer(player, Math.ceil(damage / 10));
  } else if (key === "ice") {
    drainPrayer(player, Math.floor(damage / 2));
    require("./Specials.Nex").iceFreeze(fight, player);
  } else if (key === "zaros") {
    drainPrayer(player, 5);
  }
  zarosHit(fight, player, damage, false);
}

/** The blood barrage: her target and anyone in the 3x3 around them, a quarter back to her. */
function blood(fight, target) {
  const { fight: data } = Common.data;
  const style = data.attacks.blood;
  fight.boss.performAnimation(Common.animation(style.anim));
  fight.areaSound(style.sound);
  const cycles = Common.projectile(fight.boss, target, {
    ...style.projectile,
    start: data.attacks.projectileStart,
    angle: data.attacks.projectileAngle,
    progress: data.attacks.projectileProgress,
  });
  const centre = target.getLocation();
  const victims = fight.players().filter((player) => {
    const at = player.getLocation();
    return player.getHitpoints() > 0 && Math.max(Math.abs(at.getX() - centre.getX()), Math.abs(at.getY() - centre.getY())) <= 1;
  });
  for (const player of victims) {
    Common.strike(fight.boss, player, "magic", data.magicMax, Common.landsIn(cycles), {
      prayed: (prayer) => (prayer === "magic" ? 0.5 : 1),
      landed: (damage, accurate) => {
        const sender = player.getPacketSender();
        if (!accurate) {
          player.performGraphic(Common.graphic(data.attacks.splash.graphic, { height: data.attacks.splash.height }));
          sender.sendSoundEffect(data.attacks.splash.sound, 1, 0);
          return;
        }
        player.performGraphic(Common.graphic(style.impact, { height: style.impactHeight }));
        sender.sendSoundEffect(style.impactSound, 1, 0);
        fight.noteHit(player, "blood", damage);
        if (damage <= 0) return;
        drainPrayer(player, 5);
        Common.later(1, () => {
          if (fight.stage !== "fighting") return;
          Common.healNpc(fight.boss, Math.floor(damage / 4), data.hitpoints);
          fight.areaSound(style.healSound);
        });
      },
    });
  }
}

/** Zaros phase: Soul Split's heal, and Turmoil on her melee. */
function zarosHit(fight, player, damage, melee) {
  const { zaros, npcs, fight: data } = Common.data;
  if (fight.phase().key !== "zaros" || damage <= 0 || fight.stage !== "fighting") return;
  if (fight.form() === npcs.soulSplit) {
    const spec = zaros.soulSplit;
    Common.projectile(player, fight.boss, spec);
    player.getPacketSender().sendSoundEffect(spec.sound, 1, 0);
    Common.later(Common.landsIn(spec.end), () => {
      if (fight.stage !== "fighting") return;
      Common.healNpc(fight.boss, Math.max(1, Math.floor(damage * spec.share)), data.hitpoints);
      fight.areaSound(spec.healSound);
    });
    return;
  }
  if (melee && Math.random() < zaros.turmoil.chance) turmoil(fight, player);
}

/** Turmoil, as captured: her projectile to the player, their levels drained the next tick. */
function turmoil(fight, player) {
  const { turmoil: spec } = Common.data.zaros;
  const { Skill } = Common.core;
  Common.projectile(fight.boss, player, spec);
  player.getPacketSender().sendSoundEffect(spec.sound, 1, 0);
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    player.getPacketSender().sendSoundEffect(spec.drainSound, 1, 0);
    for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC]) {
      player.getSkillManager().decreaseCurrentLevel(skill, spec.drain, 1);
    }
  });
}

module.exports = { attack, drainPrayer, inMeleeReach, shadowMax };

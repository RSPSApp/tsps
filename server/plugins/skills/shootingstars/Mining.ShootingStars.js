"use strict";

/**
 * Mining a crashed star.
 *
 * Captures: the player turns to the star, and a tick later "You swing your pick at the star."
 * (spam) with the pickaxe's mining animation. A successful attempt gives stardust with synth
 * sound 3600. The first player to mine a newly landed star gets a message box instead
 * ("Congratulations! You were the first person to find this star! ...", jingle 287) and
 * star_bonus_dust set to 300; each later success then gives one extra stardust and counts it down,
 * with a game message every 50 ("Your star discovery bonus will grant you another N star dust
 * before it runs out.") and "<col=ff3045>Your star discovery bonus has been used up." at 0.
 *
 * Wiki: the layer needs Mining level size x 10; each attempt first rolls the uncut gem table
 * (1/256, 1/64.2 with a charged glory), otherwise rolls stardust at 29% (level 1) to 46% (level
 * 99), 32 Mining xp per success (16 on free-to-play worlds), any star size.
 */

const Common = require("./Common.ShootingStars");
const Star = require("./Star.ShootingStars");
const Rewards = require("./Rewards.ShootingStars");
const Noticeboard = require("./Noticeboard.ShootingStars");

const { DATA, world } = Common;
const BONUS_USED_UP = "<col=ff3045>Your star discovery bonus has been used up.";

/** player -> { star, pickaxe, nextAttemptTick } */
const sessions = new Map();

function discoveryMessage(bonus) {
  return `Congratulations! You were the first person to find this star! Your star dust gain will be doubled for the next ${bonus} dust you mine!`;
}

function bonusLeftMessage(left) {
  return `Your star discovery bonus will grant you another ${left} star dust before it runs out.`;
}

function levelRequired(star) {
  return star.size * 10;
}

/** Stardust chance in percent: 29% at level 1 to 46% at level 99, the same for every size. */
function dustChance(level) {
  const { chanceAtLevel1, chanceAtLevel99 } = DATA.mining;
  const clamped = Math.max(1, Math.min(99, level));
  return chanceAtLevel1 + ((chanceAtLevel99 - chanceAtLevel1) * (clamped - 1)) / 98;
}

function stop(player, resetAnimation = true) {
  if (!sessions.delete(player)) return;
  if (resetAnimation) player.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
}

function stopAll(star, resetAnimation) {
  for (const [player, session] of sessions) {
    if (session.star === star) stop(player, resetAnimation);
  }
}

function playersOf(star) {
  return [...sessions].filter(([, session]) => session.star === star).map(([player]) => player);
}

function isMined(star) {
  for (const session of sessions.values()) {
    if (session.star === star) return true;
  }
  return false;
}

/** The first Mine on a newly landed star: the discovery, before any mining (captures). */
function discover(player, star) {
  star.discoveredBy = player.getUsername();
  Common.markMined(player);
  Common.setBonusDust(player, DATA.mining.bonusDust);
  player.getPacketSender().sendJingle(DATA.jingles.discovery, 0);
  Common.mesbox(player, discoveryMessage(DATA.mining.bonusDust));
  Noticeboard.discovered(player, star);
}

function startMining(player, star) {
  const pickaxe = Common.bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You don't have a pickaxe which you can use.");
    return;
  }
  const required = levelRequired(star);
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.MINING) < required) {
    player.sendMessage(`You need a Mining level of at least ${required} to mine this layer.`);
    return;
  }
  const inventory = player.getInventory();
  if (inventory.isFull() && inventory.getAmount(Common.core.ItemIdentifiers.STARDUST) <= 0) {
    inventory.full();
    return;
  }
  Common.markMined(player);
  player.setPositionToFace(Common.starCentre(star));
  player.sendMessage("You swing your pick at the star.");
  player.performAnimation(pickaxe.animation);
  sessions.set(player, { star, pickaxe, nextAttemptTick: world.tick + pickaxe.attemptIntervalTicks });
}

function mine(event) {
  const { player } = event;
  const star = world.star;
  if (!Star.isLanded(star) || event.location?.x !== star.x || event.location?.y !== star.y) return false;
  event.handled = true;
  stop(player, false);
  if (star.discoveredBy == null) {
    discover(player, star);
    return;
  }
  // The layer timer counts this tick even if the level check below fails (Wiki).
  star.pokedTick = world.tick;
  startMining(player, star);
}

function countDownBonus(player) {
  const left = Common.bonusDust(player) - 1;
  Common.setBonusDust(player, left);
  if (left <= 0) player.sendMessage(BONUS_USED_UP);
  else if (left % DATA.mining.bonusMessageEvery === 0) player.sendMessage(bonusLeftMessage(left));
}

function giveDust(player) {
  const { core } = Common;
  const bonus = Common.bonusDust(player) > 0;
  player.getInventory().adds(core.ItemIdentifiers.STARDUST, bonus ? 2 : 1);
  player.getPacketSender().sendSound(DATA.sounds.dust, 1, 0);
  const xp = Common.isMembersWorld() ? DATA.mining.xp : DATA.mining.freeToPlayXp;
  player.getSkillManager().addExperiences(core.Skill.MINING, xp);
  if (bonus) countDownBonus(player);
  Common.api.emitCustomEvent("mining:success", { player, skill: core.Skill.MINING, petBase: DATA.mining.petBase });
}

function attempt(player, session, random) {
  player.performAnimation(session.pickaxe.animation);
  if (Rewards.rollGemTable(player, random)) return;
  if (random() * 100 < dustChance(Common.rollMiningLevel(player))) giveDust(player);
}

function stillMining(player, session) {
  const { star } = session;
  if (!player.isRegistered() || player.getHitpoints() <= 0) return false;
  if (world.star !== star || !Star.isLanded(star)) return false;
  if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) return false;
  if (!Common.isNextToStar(player, star)) return false;
  const pickaxe = Common.bestPickaxe(player);
  if (!pickaxe || player.getSkillManager().getCurrentLevel(Common.core.Skill.MINING) < levelRequired(star)) return false;
  session.pickaxe = pickaxe;
  return true;
}

/** One tick for everyone mining the star. */
function tick(random = Math.random) {
  for (const [player, session] of sessions) {
    if (!stillMining(player, session)) {
      stop(player);
      continue;
    }
    const inventory = player.getInventory();
    if (inventory.isFull() && inventory.getAmount(Common.core.ItemIdentifiers.STARDUST) <= 0) {
      inventory.full();
      stop(player);
      continue;
    }
    if (world.tick < session.nextAttemptTick) continue;
    session.nextAttemptTick = world.tick + session.pickaxe.attemptIntervalTicks;
    attempt(player, session, random);
  }
}

function forget({ player }) {
  stop(player, false);
}

function attach(api) {
  Object.assign(Star.miners, { isMined, playersOf, stopAll });
  api.onObjectInteraction("Crashed Star", { Mine: mine });
  api.onPlayerDisconnect(forget);
}

module.exports = attach;
Object.assign(module.exports, {
  sessions,
  mine,
  tick,
  stop,
  stopAll,
  isMined,
  playersOf,
  dustChance,
  levelRequired,
  discoveryMessage,
  bonusLeftMessage,
  BONUS_USED_UP,
});

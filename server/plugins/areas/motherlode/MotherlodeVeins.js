/**
 * Motherlode Mine's ore veins. The map holds every vein depleted and the live veins are spawned
 * over them (as captured). A vein starts its timer when its first pay-dirt is mined, depletes when
 * it runs out, and respawns later.
 */
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { RegionManager } = require("../../../src/main/typescript/elvarg/game/collision/RegionManager");
const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { findBestPickaxe } = require("../../skills/Mining.plugin");
const Mine = require("./MotherlodeState");
const { loc, swapLoc, findLoc, areaSound } = require("./MotherlodeWorld");

/** Depleted vein (in the map) -> the live vein spawned over it: single, left, middle, right. */
const VEIN_FOR_DEPLETED = new Map([[26665, 26661], [26666, 26662], [26667, 26663], [26668, 26664]]);
const VEIN_IDS = new Set(VEIN_FOR_DEPLETED.values());

/**
 * Ticks a vein lasts after its first pay-dirt (Wiki: 23-27 seconds below, 36-40 above), and until
 * it respawns (the respawn timers the client was sent in the capture).
 */
const LIFESPAN = { lower: [38, 45], upper: [60, 67] };
const RESPAWN = { lower: [159, 176], upper: [94, 101] };
const PAY_DIRT_XP = 60;
/** OpenRune's (ISC) pay-dirt roll. */
const PAY_DIRT_CHANCE = { low: 60, high: 105 };
const ANIMATION_TICKS = 3;
const PAY_DIRT_SOUND = 3600;
const DEPLETE_SOUND = 2661;

/** Each pickaxe's wall-mining animation (RuneLite's MINING_MOTHERLODE_*; dragon as captured). */
const WALL_ANIMATIONS = new Map([
  [ItemIds.BRONZE_PICKAXE, 6753], [ItemIds.IRON_PICKAXE, 6754], [ItemIds.STEEL_PICKAXE, 6755],
  [ItemIds.BLACK_PICKAXE, 3866], [ItemIds.MITHRIL_PICKAXE, 6757], [ItemIds.ADAMANT_PICKAXE, 6756],
  [ItemIds.RUNE_PICKAXE, 6752], [ItemIds.DRAGON_PICKAXE, 6758],
]);

/** "x,y" -> vein */
const veins = new Map();
/** player -> their mining */
const miners = new Map();

function random([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function keyOf(x, y) {
  return `${x},${y}`;
}

/** Spawns a live vein over each depleted one in the map. */
function spawnAll() {
  const { minX, maxX, minY, maxY } = Mine.MINE;
  RegionManager.loadMapFiles(minX, minY);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const [depletedId, oreId] of VEIN_FOR_DEPLETED) {
        const depleted = findLoc(depletedId, [x, y]);
        if (!depleted) continue;
        const vein = {
          tile: [x, y],
          depletedId,
          oreId,
          type: depleted.getType(),
          face: depleted.getFace(),
          upper: Mine.isUpperLevel(x, y),
          depletesAt: -1,
          respawnsAt: -1,
        };
        veins.set(keyOf(x, y), vein);
        swapLoc(depleted, loc(oreId, vein.tile, vein.type, vein.face));
      }
    }
  }
}

function isActive(vein) {
  return vein.respawnsAt < 0;
}

function deplete(vein, now) {
  const ore = findLoc(vein.oreId, vein.tile);
  if (ore) swapLoc(ore, loc(vein.depletedId, vein.tile, vein.type, vein.face));
  vein.depletesAt = -1;
  vein.respawnsAt = now + random(vein.upper ? RESPAWN.upper : RESPAWN.lower);
  areaSound(DEPLETE_SOUND, vein.tile, { delay: 10, radius: 1 });
}

function respawn(vein) {
  const depleted = findLoc(vein.depletedId, vein.tile);
  if (depleted) swapLoc(depleted, loc(vein.oreId, vein.tile, vein.type, vein.face));
  vein.respawnsAt = -1;
}

function wallAnimation(pickaxe) {
  const id = WALL_ANIMATIONS.get(pickaxe.id);
  return id === undefined ? pickaxe.animation : new Animation(id);
}

function heldPayDirt(player) {
  return player.getInventory().getAmount(Mine.PAY_DIRT);
}

/** Why the player can't mine this vein now, or null. */
function refusal(player, vein) {
  const state = Mine.stateOf(player);
  if (Mine.baseMiningLevel(player) < Mine.PAY_DIRT_LEVEL) {
    return `You need a Mining level of ${Mine.PAY_DIRT_LEVEL} to mine this vein.`;
  }
  if (!findBestPickaxe(player)) return "You need a pickaxe to mine this rock.";
  if (Mine.sackTotal(state) >= Mine.capacity(state)) {
    return "The sack is full. You should collect your ore before mining any more pay-dirt.";
  }
  if (player.getInventory().isFull()) return "Your inventory is too full to hold any more pay-dirt.";
  return isActive(vein) ? null : "";
}

/** The vein's Mine. */
function mineVein({ player, objectId, location }) {
  if (!VEIN_IDS.has(objectId)) return false;
  const vein = veins.get(keyOf(location.x, location.y));
  if (!vein) return false;
  const refused = refusal(player, vein);
  if (refused !== null) {
    if (refused) player.sendMessage(refused);
    return;
  }
  const state = Mine.stateOf(player);
  if (Mine.space(state) - heldPayDirt(player) <= 0) {
    player.sendMessage("You already have enough pay-dirt to fill the sack.");
  }
  const pickaxe = findBestPickaxe(player);
  player.sendMessage("You swing your pick at the rock.");
  player.performAnimation(wallAnimation(pickaxe));
  miners.set(player, { vein, nextRollIn: pickaxe.attemptIntervalTicks, nextAnimationIn: ANIMATION_TICKS });
}

function stopMining(player, resetAnimation = true) {
  if (!miners.delete(player)) return;
  if (resetAnimation) player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
}

/** Wiki: "Ores are determined when the pay-dirt is mined, not when cleaning." */
function awardPayDirt(player, vein, now) {
  const state = Mine.stateOf(player);
  state.held.push(Mine.rollOre(Mine.miningLevel(player)).key);
  Mine.save(player, state);
  player.getInventory().add(new Item(Mine.PAY_DIRT, 1), true);
  player.getSkillManager().addExperiences(Skill.MINING, PAY_DIRT_XP);
  player.sendMessage("You manage to mine some pay-dirt.");
  player.getPacketSender().sendSound(PAY_DIRT_SOUND, 0, 0);
  if (vein.depletesAt < 0) vein.depletesAt = now + random(vein.upper ? LIFESPAN.upper : LIFESPAN.lower);
}

function tickMiner(player, mining, now) {
  if (!player.isRegistered?.() || player.getMovementQueue().size() > 0) return stopMining(player);
  const { vein } = mining;
  const refused = refusal(player, vein);
  if (refused !== null) {
    if (refused) player.sendMessage(refused);
    return stopMining(player);
  }
  const pickaxe = findBestPickaxe(player);
  if (--mining.nextAnimationIn <= 0) {
    mining.nextAnimationIn = ANIMATION_TICKS;
    player.performAnimation(wallAnimation(pickaxe));
  }
  if (--mining.nextRollIn > 0) return;
  mining.nextRollIn = pickaxe.attemptIntervalTicks;
  if (Math.random() < Mine.successChance(PAY_DIRT_CHANCE.low, PAY_DIRT_CHANCE.high, Mine.miningLevel(player))) {
    awardPayDirt(player, vein, now);
  }
}

function tick(now) {
  for (const vein of veins.values()) {
    if (vein.depletesAt >= 0 && now >= vein.depletesAt) deplete(vein, now);
    else if (vein.respawnsAt >= 0 && now >= vein.respawnsAt) respawn(vein);
  }
  for (const [player, mining] of miners) tickMiner(player, mining, now);
}

module.exports = { spawnAll, mineVein, stopMining, tick, veins, miners, VEIN_IDS, LIFESPAN, RESPAWN };

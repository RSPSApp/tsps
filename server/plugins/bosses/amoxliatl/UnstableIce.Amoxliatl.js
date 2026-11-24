/**
 * Unstable Ice, as captured with the Wiki's rules:
 * - She summons (11533) with "Amoxliatl forms some unstable ice blocks around you." and throws
 *   1-4 blocks (Wiki) at tiles near the player; 3 ticks later they stand there (13688, 11536).
 * - Only melee hurts them, and a melee hit on one is a max hit with no attack delay, at speed 1
 *   (Wiki). They have 10 hitpoints, so every hit breaks one: it bursts (11035) and is gone a tick
 *   later, leaving an icy pool where it stood (captured).
 * - In the ordinary post-quest fight, any left 14 ticks after forming shatter, each healing her
 *   16-25 with a hitsplat and leaving a diamond of icy pools (R1140 ticks 7912-7927, 8788-8803).
 */
const Common = require("./Common.Amoxliatl");

const NO_RETALIATE_FLAG = "combat:no-retaliate";

const key = (x, y) => `${x},${y}`;

/** Floor tiles near the player for the blocks: free, not hers, not the path, not the player's own. */
function targets(fight, count) {
  const { onFloor } = require("./Fight.Amoxliatl");
  const { RegionManager } = Common.core;
  const { reach } = Common.data.unstableIce;
  const [px, py] = fight.playerTile();
  const [bx, by] = fight.session.worldTile(fight.boss.getLocation());
  const size = fight.boss.getSize();
  const taken = new Set([...fight.blocks].map((block) => key(...fight.session.worldTile(block.getLocation()))));
  const options = [];
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const x = px + dx;
      const y = py + dy;
      if ((dx === 0 && dy === 0) || !onFloor(x, y) || fight.onPath([x, y]) || taken.has(key(x, y))) continue;
      if (x >= bx && x < bx + size && y >= by && y < by + size) continue;
      if (RegionManager.blocked(fight.session.tile([x, y, 0]), fight.session.area)) continue;
      options.push([x, y]);
    }
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options.slice(0, count);
}

/** The special: the summon, the throws, and the blocks a few ticks later. */
function launch(fight) {
  const { Animation, Projectile } = Common.core;
  const ice = Common.data.unstableIce;
  fight.boss.performAnimation(new Animation(ice.anim));
  const { message, shatterTicks } = Common.isPostQuestFight(fight.session) ? ice.postQuest : ice;
  fight.player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, message);
  const [min, max] = ice.count;
  const tiles = targets(fight, Common.randomInt(min, max));
  const from = Projectile.centreOf(fight.boss);
  const spec = ice.projectile;
  for (const [x, y] of tiles) {
    const to = fight.session.tile([x, y, 0]);
    new Projectile(from, to, null, spec.id, spec.start, spec.end, spec.startHeight, spec.endHeight, fight.session.area)
      .withAngle(spec.angle)
      .withProgress(spec.progress)
      .sendProjectile();
    Common.tileGraphic(fight.player, to, ice.impactSpotanim, spec.end);
  }
  fight.at(ice.spawnTicks, () => {
    const formed = tiles.map(([x, y]) => form(fight, x, y)).filter(Boolean);
    if (formed.length > 0) fight.at(shatterTicks, () => shatter(fight, formed));
  });
}

/** One block on its tile: still, harmless, there to be broken. */
function form(fight, x, y) {
  if (fight.stopped || fight.over) return null;
  const { Animation } = Common.core;
  const ice = Common.data.unstableIce;
  const block = fight.session.spawn(Common.data.npcs.iceBlock, [x, y, 0], Common.core.Direction.SOUTH.getId());
  if (!block) return null;
  block.__amoxliatlIce = fight;
  block.setFlag(NO_RETALIATE_FLAG, true);
  block.getMovementQueue().setBlockMovement(true).reset();
  block.performAnimation(new Animation(ice.spawnAnim));
  Common.areaSound(fight.player, ice.spawnSound, block.getLocation());
  fight.blocks.add(block);
  return block;
}

/** A block bursts (broken or shattering): its animation and sound, gone a tick later. */
function burst(fight, block) {
  const { Animation } = Common.core;
  const ice = Common.data.unstableIce;
  fight.blocks.delete(block);
  fight.burstingBlocks.add(block);
  block.performAnimation(new Animation(ice.breakAnim));
  Common.areaSound(fight.player, ice.breakSound, block.getLocation());
}

/** The remaining blocks burst and heal her. Their models disappear on the next tick. */
function shatter(fight, formed) {
  const left = formed.filter((block) => fight.blocks.has(block) && block.isRegistered() && block.getHitpoints() > 0);
  if (left.length === 0 || fight.over) return;
  fight.stats.shattered = true;
  const { shatterHeal: [min, max], postQuest, removeAfterBreakTicks } = Common.data.unstableIce;
  const ordinaryFight = Common.isPostQuestFight(fight.session);
  const { shatterHealSplat, shatterPoolReach: reach } = postQuest;
  let playedPoolSound = false;
  for (const block of left) {
    burst(fight, block);
    const heal = Common.randomInt(min, max);
    fight.boss.heal(heal);
    const [x, y] = fight.session.worldTile(block.getLocation());
    if (ordinaryFight) {
      fight.boss.showHitsplat(heal, { mine: shatterHealSplat, others: shatterHealSplat });
      for (let dx = -reach; dx <= reach; dx++) {
        const span = reach - Math.abs(dx);
        for (let dy = -span; dy <= span; dy++) {
          if (fight.placePool(x + dx, y + dy, !playedPoolSound)) playedPoolSound = true;
        }
      }
    }
    fight.at(removeAfterBreakTicks, () => {
      fight.burstingBlocks.delete(block);
      if (block.isRegistered()) Common.api.removeNpc(block);
      if (!ordinaryFight) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fight.placePool(x + dx, y + dy);
      }
    });
  }
}

/** Every block goes with the fight (her death, the chamber closing). */
function clear(fight) {
  for (const block of [...fight.blocks, ...fight.burstingBlocks]) {
    if (block.isRegistered()) Common.api.removeNpc(block);
  }
  fight.blocks.clear();
  fight.burstingBlocks.clear();
}

// ------------------------------------------------------------------ hooks

const isBlock = (mobile) => Boolean(mobile?.__amoxliatlIce);
const isMelee = (type) => type === Common.core.CombatType.MELEE;

/** A melee hit on a block is a max hit (Wiki). */
function blockHitRoll(roll) {
  if (!isBlock(roll.target) || !isMelee(roll.combatType)) return;
  roll.forceAccurate = true;
  roll.forceMaxHit = true;
}

/** Only melee hurts them (Wiki). */
function blockHitModify({ npc, hit }) {
  if (!isBlock(npc) || isMelee(hit.getCombatType?.())) return;
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
}

/** Melee on a block ignores the weapon's delay, and leaves one of a tick (Wiki: attack speed 1). */
function blockAttackTiming(event) {
  if (!isBlock(event.target) || !event.attacker?.isPlayer?.() || !isMelee(event.method?.type?.())) return;
  event.ignoreDelay = true;
  event.keepDelay = true;
  event.minimumDelay = 1;
}

/** Broken: it bursts as it falls (the NPC's own death takes it a tick later). */
function blockBeforeDeath(event) {
  const fight = event.npc?.__amoxliatlIce;
  if (!fight || event.preventDeath || !fight.blocks.has(event.npc)) return;
  burst(fight, event.npc);
}

/** Gone: an icy pool where it stood (captured). */
function blockDeath({ npc }) {
  const fight = npc?.__amoxliatlIce;
  if (!fight) return;
  fight.burstingBlocks.delete(npc);
  const [x, y] = fight.session.worldTile(npc.getLocation());
  fight.placePool(x, y);
}

function attachUnstableIce(api) {
  api.onCombatHitRoll(blockHitRoll);
  api.onNpcHitModify(blockHitModify);
  api.onAttackTiming(blockAttackTiming);
  api.onNpcBeforeDeath(blockBeforeDeath);
  api.onNpcDeath(blockDeath);
}

module.exports = { attachUnstableIce, launch, clear, targets };

// Dead sea creatures and their loot (rsprox: the user's captures; Wiki: Boat combat).
// - A creature dies as any NPC does (its death animation and sound, npc-combat-defs.json: rsprox),
//   then 2 ticks later lies on the water as its corpse (the `_dead` id, op1 Harvest) for two
//   minutes (Wiki), and respawns its usual time after that.
//   Its drops don't land on the water: they are rolled when it is harvested.
// - Harvest, by the player who killed it: beside the hull they pick it up (human_pickupfloor);
//   further out they throw a net (sailing_human_loot_net_cast_01, its spotanims and projectile)
//   and drag the corpse in (the net's spotanim on it for four ticks, then the despawn one). The
//   loot goes straight into the inventory, each item flying in (script 7192) with sound 2581; it
//   all drops under the player when there isn't room for all of it (Wiki).
// - What else a harvest gives (a bounty task's parts, porttasks/Bounty.PortTasks.js) is added
//   by "sea-combat:harvest" listeners. Then the loot goes through the same hooks as a kill's
//   (NpcDrops' npc-drops:add, :roll with everyone who damaged it, :generated), so an Ironman's
//   shared kill, members items on a free world and the collection log apply as to any drop.
const common = require("./Common.SeaCombat");
const { playSound } = require("../SailingContent.Sailing");

/** Wiki: corpses despawn after two minutes. */
const CORPSE_TICKS = 200;
/** A corpse beside the hull is picked up rather than netted (ours). */
const PICK_UP_DISTANCE = 1;
/** How far a net is thrown (ours). */
const NET_RANGE = 10;
const ANIM_PICK_UP = 827;
const ANIM_NET = 13273;
const GRAPHIC = Object.freeze({ NET_CAST: 3519, NET_PROJECTILE: 3520, NET_IMPACT: 3521, NET_DRAG: 3522, NET_DESPAWN: 3523 });
/** rsprox prints map_projanim_v2 heights four times over: 128 there is 32. */
const NET_PROJECTILE = Object.freeze({ delay: 30, cycles: 90, angle: 255, progress: 112, startHeight: 32, endHeight: 0 });
/** The net's impact on the player, 60 cycles in (rsprox), in spotanim slot 5; the cast in slot 1. */
const NET_IMPACT_DELAY = 60;
/** Ticks the net drags the corpse in, then the despawn tick, then the loot (rsprox: 920 cast, 923-926 drag, 927 despawn, 929 loot). */
const NET_DRAG_START = 3;
const NET_DRAG_TICKS = 4;
const NET_LOOT_TICKS = 9;
/** The net pulls the corpse a tile a tick towards the player, from the tick after the throw (rsprox: 921-926). */
const PULL_TICKS = 6;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const SOUND_LOOT = 2581;
const SCRIPT_LOOT_FLY = 7192;

/** corpse npc -> `{ owner, creature, harvesting }`. */
const corpses = new Map();
/** Combat clears its damage record during death; keep applied damage, not rolled cannon XP. */
const damageAtDeath = new WeakMap();
const landedDamage = new WeakMap();

/** The combat credit total can contain queued overkill. Count actual HP loss per splat. */
function hitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !common.creatureOf(target)) return;
  let landed = landedDamage.get(target);
  if (!landed) landedDamage.set(target, landed = new WeakMap());
  // The shared combat owner decides when this player's earlier fight has expired/reset.
  if (!target.getCombat().damageMapContains(attacker)) landed.set(attacker, 0);
  for (const part of hit.getHits()) {
    part.onApplied((taken) => landed.set(attacker, (landed.get(attacker) ?? 0) + taken));
  }
}

function beforeDeath({ npc, preventDeath }) {
  if (preventDeath || !common.creatureOf(npc)) return;
  damageAtDeath.set(npc, {
    hitpoints: npc.getMaxHitpoints(),
    entries: npc.getCombat().getRecentDamagerEntries(),
    // Keep the reference: appendDeath runs before the fatal splat's onApplied observer.
    landed: landedDamage.get(npc),
  });
}

/** Reward plugins query the original creature and contribution while its corpse is harvested. */
function rewardContext(request) {
  const corpse = corpses.get(request.npc);
  if (!corpse || corpse.owner !== request.player) return;
  request.creature = corpse.creature;
  request.damageShare = corpse.damageShare;
}
/** Each harvest's loot key (script 7192), counting up as live's do (185827, 185828). */
let lootKey = 185827;

function later(entity, ticks, action) {
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), entity, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The corpse takes the creature's place for two minutes. */
function onDeath(event) {
  const creature = common.DATA.creatures.find((candidate) => candidate.npc === event.npcId);
  if (!creature) return;
  const { npc, killer } = event;
  event.remains = { ticks: CORPSE_TICKS };
  npc.getCombat().reset();
  npc.setNpcTransformationId(creature.dead);
  npc.setHitpoints(1);
  // Who damaged it decides the loot rules at the harvest (an Ironman's shared kill).
  const damage = damageAtDeath.get(npc);
  damageAtDeath.delete(npc);
  const applied = damage?.landed
    ? damage.landed.get(killer) ?? 0
    : damage?.entries.find((entry) => entry.player === killer)?.damage ?? 0;
  landedDamage.delete(npc);
  // Synthetic/admin deaths without a combat snapshot retain the usual solo reward.
  const damageShare = damage ? Math.max(0, Math.min(1, applied / Math.max(1, damage.hitpoints))) : 1;
  corpses.set(npc, { owner: killer, creature, damageShare, damagers: event.damagers ?? [killer], harvesting: false });
  later(npc, CORPSE_TICKS, () => corpses.delete(npc));
}

/** Sea creatures' drops wait for the harvest, instead of landing on the water. */
function claimDrops(claim) {
  if (common.DATA.creatures.some((creature) => creature.npc === claim.npcId)) claim.handled = true;
}

/** Harvest is reached from the deck at a net's throw. */
function route(event) {
  if (!common.corpseOf(event.npc)) return;
  event.range = NET_RANGE;
  event.ignoreProjectileClip = true;
}

function harvest(event) {
  const { player, npc } = event;
  const corpse = corpses.get(npc);
  if (!corpse) return false;
  event.handled = true;
  if (corpse.owner !== player) {
    player.sendMessage("That isn't yours to harvest.");
    return true;
  }
  if (corpse.harvesting) return true;
  const aboard = common.ownBoat(player);
  const distance = aboard ? common.distanceToBoat(npc, aboard.boat) : 0;
  corpse.harvesting = true;
  player.getMovementQueue().reset();
  const { Animation, Graphic, Projectile, BoatManager } = common.core();
  player.setPositionToFace(npc.getLocation());
  if (distance <= PICK_UP_DISTANCE) {
    player.performAnimation(new Animation(ANIM_PICK_UP));
    later(player, 1, () => loot(player, npc, corpse));
    return true;
  }
  player.performAnimation(new Animation(ANIM_NET));
  player.performGraphic(new Graphic(GRAPHIC.NET_CAST));
  player.performGraphic(new Graphic(GRAPHIC.NET_IMPACT, NET_IMPACT_DELAY, 0));
  new Projectile(BoatManager.rootLocation(player), Projectile.centreOf(npc), npc, GRAPHIC.NET_PROJECTILE,
    NET_PROJECTILE.delay, NET_PROJECTILE.cycles, NET_PROJECTILE.startHeight, NET_PROJECTILE.endHeight, null)
    .withAngle(NET_PROJECTILE.angle).withProgress(NET_PROJECTILE.progress).sendProjectile();
  for (let tick = 0; tick < NET_DRAG_TICKS; tick++) {
    later(npc, NET_DRAG_START + tick, () => npc.isRegistered?.() && npc.performGraphic(new Graphic(GRAPHIC.NET_DRAG)));
  }
  // Dying locked its movement (NPCDeathTask); the net moves it.
  npc.getMovementQueue().setBlockMovement(false);
  npc.setScriptedMovement?.(true);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, true);
  for (let tick = 1; tick <= PULL_TICKS; tick++) later(npc, tick, () => pull(player, npc));
  later(npc, NET_DRAG_START + NET_DRAG_TICKS, () => npc.isRegistered?.() && npc.performGraphic(new Graphic(GRAPHIC.NET_DESPAWN)));
  later(player, NET_LOOT_TICKS, () => loot(player, npc, corpse));
  return true;
}

/** One tile of the net's pull towards the player, over the water, stopping beside the hull. */
function pull(player, npc) {
  if (!npc.isRegistered?.()) return;
  const aboard = common.ownBoat(player);
  if (aboard && common.distanceToBoat(npc, aboard.boat) <= 1) return;
  const towards = common.core().BoatManager.rootLocation(player);
  require("./Creatures.SeaCombat").step(npc, towards.getX(), towards.getY());
}

/** Rolls the creature's drops (and what listeners add) into the inventory, and the corpse goes. */
function loot(player, npc, corpse) {
  if (corpses.get(npc) !== corpse) return;
  const drops = [];
  const api = common.api();
  const npcId = corpse.creature.npc;
  api.emitCustomEvent("npc-drops:roll-table", { player, npcId, drops, npc });
  // `claims`: parts listeners give only if they're still in the loot once its rules have run.
  const harvest = { player, npc, creature: corpse.creature, drops, extra: [], claims: [] };
  api.emitCustomEvent("sea-combat:harvest", harvest);
  const all = [...drops, ...harvest.extra];
  api.emitCustomEvent("npc-drops:add", { player, npc, npcId, drops: all });
  api.emitCustomEvent("npc-drops:roll", { player, npc, npcId, drops: all, damagers: corpse.damagers });
  const generated = { player, npc, npcId, drops: all, handled: false };
  api.emitCustomEvent("npc-drops:generated", generated);
  for (const claim of harvest.claims) {
    if (!generated.handled && all.some((drop) => drop.itemId === claim.itemId && drop.amount > 0)) claim.commit();
  }
  corpses.delete(npc);
  removeCorpse(npc);
  if (generated.handled) return;
  const kept = all.filter((drop) => Number.isInteger(drop.itemId) && drop.amount > 0);
  // Wiki (Seed box), 6 May 2026: "The seed box now works with looting Sailing creatures while opened."
  // Taken off the drops first, so a full bag's placing below doesn't put a copy on the floor.
  for (const drop of kept) {
    if (drop.noted) continue;
    const request = { player, itemId: drop.itemId, amount: drop.amount, stored: 0 };
    api.emitCustomEvent("seed-box:gather", request);
    drop.amount -= request.stored;
  }
  all.splice(0, all.length, ...kept.filter((drop) => drop.amount > 0));
  if (!all.length) return;
  const { Item, ItemDefinition } = common.core();
  const inventory = player.getInventory();
  const resolved = all.map((drop) => {
    const definition = ItemDefinition.forId(drop.itemId);
    const noteId = definition.getNoteId?.() ?? -1;
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    return { itemId, amount: drop.amount, stackable: ItemDefinition.forId(itemId).isStackable() };
  });
  const slotsNeeded = resolved.reduce((needed, drop) => needed
    + (drop.stackable ? (inventory.getAmount(drop.itemId) > 0 ? 0 : 1) : drop.amount), 0);
  if (slotsNeeded > inventory.getFreeSlots()) {
    api.emitCustomEvent("npc-drops:place", { player, drops: all, location: player.getLocation() });
    return;
  }
  const key = lootKey++;
  playSound(player, SOUND_LOOT);
  for (const drop of resolved) {
    if (drop.stackable) inventory.add(new Item(drop.itemId, drop.amount), false);
    else for (let i = 0; i < drop.amount; i++) inventory.add(new Item(drop.itemId, 1), false);
    player.getPacketSender().sendClientScript(SCRIPT_LOOT_FLY, corpse.creature.dead, key, drop.itemId, drop.amount);
  }
  inventory.refreshItems();
}

/** The corpse goes once harvested; the creature still respawns on the unharvested corpse's time. */
function removeCorpse(npc) {
  npc.setScriptedMovement?.(false);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, false);
  if (npc.isRegistered?.()) common.core().World.getRemoveNPCQueue().push(npc);
}

function attach(api) {
  common.init(api);
  api.onCombatHitResolved(hitResolved);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(onDeath);
  api.onCustomEvent("sea-combat:reward-context", rewardContext);
  api.onCustomEvent("npc-drops:claim", claimDrops);
  api.onNpcRoute(route);
  api.onAnyNpcInteraction({ Harvest: harvest });
}

module.exports = attach;
module.exports.corpses = corpses;
module.exports.harvest = harvest;
module.exports.loot = loot;
module.exports.CORPSE_TICKS = CORPSE_TICKS;

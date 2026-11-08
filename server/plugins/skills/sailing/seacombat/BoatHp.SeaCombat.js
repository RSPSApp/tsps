// A boat's hitpoints at sea (rsprox: the user's captures; Wiki: Boat combat).
// - The boat's HP-bar NPC (boat_hp_npc_tiny/small/medium) stands on its deck while the player is
//   aboard: damage to the boat shows as hitsplats on it, with the boat's health bar (headbar 19 on
//   a skiff, 100 wide; 21 on a sloop, 140 wide; a raft's 17 is inferred from the sizes' pattern).
// - Damage and repairs change the boat's HP (sailing_sidepanel_boat_hp and the slot's stored HP).
// - At 0 HP the boat is lost to the sea: the recovery-loss cargo categories go, and the player (and crew) are
//   sent back to their return point; the boat stays sunk until a shipwright recovers it.
const common = require("./Common.SeaCombat");
const { dropLostOnRecovery } = require("../Cargo.Sailing");

/** Each boat type's HP-bar NPC (boat_hp_npc_tiny, _small, _medium), its deck tile and health bar. */
const HP_NPCS = Object.freeze({
  raft: { npc: 15186, tile: { x: 3, y: 3 }, bar: { id: 17, width: 60 } },
  skiff: { npc: 15187, tile: { x: 3, y: 3 }, bar: { id: 19, width: 100 } },
  sloop: { npc: 15188, tile: { x: 3, y: 8 }, bar: { id: 21, width: 140 } },
});
/** Hitsplats on the boat: a block and damage, the owner's and everyone else's (rsprox: 12 for the owner's 0). */
const SPLAT_BLOCK = Object.freeze({ mine: 12, others: 13 });
const SPLAT_DAMAGE = Object.freeze({ mine: 16, others: 17 });
const VARBIT_BOAT_HP = 19181; // sailing_sidepanel_boat_hp
const VARBIT_STORED_HP0 = 19458; // sailing_boat_1_stored_hp, one per boat slot

/** boat -> its HP-bar NPC. */
const hpNpcs = new Map();

function maxHitpoints(owned) {
  return require("../BoatParts.Sailing").boatStats(owned).hitpoints;
}

function hitpointsOf(owned) {
  return Math.max(0, maxHitpoints(owned) - (owned.damage ?? 0));
}

/** Sends the boat's HP to its side panel and stored-HP varbit. */
function sendHitpoints(player, owned) {
  owned.hitpoints = hitpointsOf(owned);
  player.getPacketSender().sendVarbit(VARBIT_BOAT_HP, owned.hitpoints);
  player.getPacketSender().sendVarbit(VARBIT_STORED_HP0 + owned.slot, owned.hitpoints);
}

/** The HP-bar NPC on a boat, if one stands there. */
function hpNpcOf(boat) {
  return hpNpcs.get(boat);
}

/** A hitsplat on the boat's HP-bar NPC, with the boat's health bar. */
function showHit(boat, owned, damage) {
  const npc = hpNpcs.get(boat);
  const spec = HP_NPCS[owned.type];
  if (!npc || !spec) return;
  npc.showHitsplat(damage, damage > 0 ? SPLAT_DAMAGE : SPLAT_BLOCK,
    { current: hitpointsOf(owned), max: Math.max(1, maxHitpoints(owned)), bar: spec.bar });
}

/**
 * Damages the player's own boat (`boat`, the instance they're aboard, for the hitsplat): its HP
 * and the hitsplat on its HP-bar NPC. Returns the HP left.
 */
function damage(player, owned, amount, boat) {
  const max = maxHitpoints(owned);
  owned.damage = Math.min(max, (owned.damage ?? 0) + Math.max(0, amount));
  sendHitpoints(player, owned);
  if (boat) showHit(boat, owned, amount);
  return owned.hitpoints;
}

/** Repairs the player's boat by up to `amount` HP. Returns how much it healed. */
function heal(player, owned, amount) {
  const before = owned.damage ?? 0;
  owned.damage = Math.max(0, before - Math.max(0, amount));
  sendHitpoints(player, owned);
  return before - owned.damage;
}

/** Combat capsize loses the same cargo categories as recovery (Wiki: Sailing / Boat). */
function loseCargo(owned) {
  dropLostOnRecovery(owned);
}

/** The boat's HP-bar NPC comes aboard a tick after the player, with the crew (as Deck.Crew.js). */
function onBoarded({ player, boat, owned }) {
  const { Sailing, CountdownTask, TaskManager } = common.core();
  if (Sailing.instanceAboard(player) !== boat || !owned) return;
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (Sailing.instanceAboard(player) !== boat || hpNpcs.has(boat)) return;
    const spec = HP_NPCS[owned.type];
    const deck = common.core().BoatManager.getDeck(boat);
    if (!spec || !deck) return;
    const npc = common.api().spawnNpc({ id: spec.npc, x: boat.deckBaseX + spec.tile.x, y: boat.deckBaseY + spec.tile.y, z: 0, owner: player });
    if (!npc) return;
    npc.setFlag?.(common.core().NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    deck.enter(npc);
    hpNpcs.set(boat, npc);
  }));
}

function onLeft({ boat }) {
  const npc = hpNpcs.get(boat);
  if (!npc) return;
  hpNpcs.delete(boat);
  common.api().removeNpc(npc);
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("sailing:boarded", onBoarded);
  api.onCustomEvent("sailing:left", onLeft);
}

module.exports = attach;
module.exports.HP_NPCS = HP_NPCS;
module.exports.damage = damage;
module.exports.heal = heal;
module.exports.loseCargo = loseCargo;
module.exports.showHit = showHit;
module.exports.hpNpcOf = hpNpcOf;
module.exports.hitpointsOf = hitpointsOf;
module.exports.maxHitpoints = maxHitpoints;
module.exports.sendHitpoints = sendHitpoints;

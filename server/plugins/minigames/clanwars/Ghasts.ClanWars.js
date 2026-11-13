/** Ghastly's shared initial hazards. See docs/clan-wars.md for the bounded TSPS policy. */
const C = require("./Common.ClanWars");
const GHAST_GAMEVAL = "templetrek_ghast_vis_2";
const SPAWNS = Object.freeze([[3410, 4936, 0], [3438, 4983, 0]].map(Object.freeze));
const MORTAL_ATTRIBUTE = "dev:mortal"; // Mobile's existing developer-immunity setting.
// Weak records deliberately survive death/leave/finish while old queued hits retain their source.
const owners = new WeakMap();
const retired = new WeakSet();
const attacks = new WeakMap();
const impacts = new WeakMap();

function applies(game) { return game.layout.hazard === "ghasts"; }
function fighter(game, player) {
  return player?.isPlayer?.() === true && player.isRegistered() && player.getHitpoints() > 0
    && !player.isDyingReturn() && !player.isUntargetable() && C.matches.get(player) === game
    && game.fighters.has(player) && !game.jailed.has(player) && !game.viewers.has(player)
    && player.getArea() === game.area;
}
function current(game, npc) {
  return owners.get(npc) === game && !retired.has(npc) && npc.isRegistered()
    && npc.getHitpoints() > 0 && npc.getArea() === game.area && !game.area.isDestroyed()
    && game.ghasts?.ready === true && game.phase === "combat" && !game.expired();
}
function pair(game, npc, player) { return current(game, npc) && fighter(game, player); }
function canAttack(game, attacker, target, method) {
  if (!applies(game)) return false;
  const npc = attacker.isNpc() ? attacker : target.isNpc() ? target : null;
  const player = attacker.isPlayer() ? attacker : target.isPlayer() ? target : null;
  if (!npc || !player || !pair(game, npc, player)) return false;
  if (attacker.isPlayer() && game.rules.specialattacks === 2 && attacker.isSpecialActivated()) return false;
  return method == null || method.type() === C.core.CombatType.MELEE;
}
function aggression(game, player, npc) { return applies(game) ? pair(game, npc, player) : null; }

function definitions() {
  const id = C.core.CacheDefinitions.getNpcId(GHAST_GAMEVAL);
  if (id == null || id !== C.core.NpcIdentifiers.GHAST_7) throw new Error("Missing Ghastly NPC");
  const def = C.core.NpcDefinition.forId(id);
  const item = C.core.CacheDefinitions.getItem(C.core.ItemIdentifiers.ROTTEN_FOOD);
  if (def.getName() !== "Ghast" || def.getCombatLevel() !== 109 || def.getSize() !== 2
    || def.getHitpoints() !== 135 || def.getAttackSpeed() !== 8 || def.getMaxHit() !== 8
    || !def.isAggressive() || def.getAttackStyle() !== "crush"
    || def.getAttackAnim() !== 1087 || def.getDefenceAnim() !== 1088 || def.getDeathAnim() !== 1089
    || !def.getActions().some(a => a?.toLowerCase() === "attack")
    || def.getStats().slice(0, 5).some((v, i) => v !== [110, 70, 70, 30, 30][i])
    || item.name !== "Rotten food" || item.noteTemplate >= 0 || item.placeholderTemplate >= 0) {
    throw new Error("Ghastly definitions are not ready");
  }
  return id;
}
function prepare(game) {
  if (!applies(game)) return true;
  if (game.ghasts) return game.ghasts.ready;
  game.ghasts = { ready: false, npcs: [], awaiting: new Set() };
  try {
    const id = definitions();
    for (const tile of SPAWNS) {
      const at = game.area.at(tile);
      const npc = C.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
      if (!npc) throw new Error("Ghastly spawn refused");
      owners.set(npc, game);
      npc.__skipDefaultRespawn = true; // Set before NPCDeathTask reads it, not in area.leave.
      game.ghasts.npcs.push(npc);
      game.area.add(npc);
      if (!npc.isRegistered()) game.ghasts.awaiting.add(npc);
      registered(game, npc);
      if (npc.getArea() !== game.area || (!npc.isRegistered() && !C.core.World.getAddNPCQueue().includes(npc))) {
        throw new Error("Ghastly spawn not admitted");
      }
    }
    game.ghasts.ready = true;
    return true;
  } catch (error) {
    game.ghasts.failure = String(error?.message ?? error);
    stop(game);
    return false;
  }
}
function reconcile(game) {
  if (!applies(game)) return true;
  if (!game.ghasts?.ready) return false;
  for (const npc of game.ghasts.awaiting) {
    if (npc.isRegistered()) registered(game, npc);
    else if (!C.core.World.getAddNPCQueue().includes(npc)) {
      game.ghasts.failure = "Ghastly queued registration failed";
      game.ghasts.ready = false;
      return false; // World consumed a refused addition; cancel, never retry/requeue.
    }
  }
  return true;
}
function registered(game, npc) {
  // add() owns queued actors; enter() indexes only their final registered world slot.
  if (owners.get(npc) === game && !retired.has(npc) && npc.isRegistered()
    && npc.getArea() === game.area && !game.area.isDestroyed()) {
    if (!game.area.hasMember(npc)) game.area.enter(npc);
    game.ghasts.awaiting.delete(npc);
  }
}
function left(game, npc) {
  if (owners.get(npc) !== game) return;
  retired.add(npc);
  npc.__skipDefaultRespawn = true;
  npc.getCombat().reset();
  // DeathTask owns a dying NPC's ordinary removal. An externally departed live hazard cannot become a world NPC.
  if (npc.getHitpoints() > 0) C.api.removeNpc(npc);
}
function stop(game) {
  if (!game.ghasts) return;
  game.ghasts.ready = false;
  game.ghasts.awaiting.clear();
  for (const npc of game.ghasts.npcs) {
    retired.add(npc);
    npc.__skipDefaultRespawn = true;
    npc.getCombat().reset();
    C.api.removeNpc(npc);
    if (npc.getArea() === game.area) game.area.leave(npc, false);
  }
}
function playerLeft(game, player) {
  for (const npc of game.ghasts?.npcs ?? []) {
    if (npc.getCombat().getTarget() === player) npc.getCombat().reset();
  }
}
function died({ npc }) {
  if (!owners.has(npc)) return;
  retired.add(npc);
  npc.__skipDefaultRespawn = true;
  npc.getCombat().reset();
}
function claimDrops(event) { if (owners.has(event.npc)) event.handled = true; }

function combatClass() {
  return class GhastMelee extends C.core.MeleeCombatMethod {
    hits(npc, target) {
      const hits = super.hits(npc, target);
      const game = owners.get(npc);
      if (game && pair(game, npc, target)) {
        for (const hit of hits) attacks.set(hit, { npc, target, game, method: this });
      }
      return hits;
    }
  };
}
function resolved({ attacker, target, hit }) {
  const proof = attacks.get(hit);
  if (!proof || proof.npc !== attacker || proof.target !== target
    || hit.getCombatMethod() !== proof.method || hit.getCombatType() !== C.core.CombatType.MELEE) return;
  for (const damage of hit.getHits()) impacts.set(damage, proof);
}
function food(def, item, rotten) {
  const actions = def?.inventoryActions ?? [];
  return item.getId() !== rotten && Number.isInteger(item.getAmount()) && item.getAmount() > 0
    && def && def.noteTemplate < 0 && def.placeholderTemplate < 0
    && actions.some(a => a?.toLowerCase() === "eat") && !actions.some(a => a?.toLowerCase() === "drink");
}
function spoil(player) {
  const inventory = player.getInventory(), items = inventory.getItems(), rotten = C.core.ItemIdentifiers.ROTTEN_FOOD;
  for (let slot = 0; slot < inventory.capacity(); slot++) {
    const item = items[slot];
    if (!item || !C.core.CacheDefinitions.hasItem(item.getId()) || !food(C.core.CacheDefinitions.getItem(item.getId()), item, rotten)) continue;
    const count = item.getAmount();
    const empty = count === 1 ? slot : items.findIndex((_, i) => !inventory.isSlotOccupied(i));
    if (empty < 0) continue;
    const output = new C.core.Item(rotten, 1, item.getMeta());
    // Selection, exact-slot capacity check and commit are synchronous; no id-wide delete or storage fallback.
    if (inventory.get(slot) !== item || item.getAmount() !== count) continue;
    if (count === 1) inventory.setItem(slot, output);
    else {
      item.setAmount(count - 1);
      inventory.setItem(empty, output);
    }
    inventory.refreshItems();
    return true;
  }
  return false;
}
function damageApply({ target, hit }) {
  const npc = hit.getSource(), game = npc && owners.get(npc);
  if (!game) return;
  if (!pair(game, npc, target)) { hit.setDamage(0); return; }
  const proof = impacts.get(hit);
  impacts.delete(hit);
  if (!proof || proof.npc !== npc || proof.target !== target || proof.game !== game
    || hit.isReflected() || hit.getOrigin() != null || hit.getHitmask() === C.core.HitMask.GREEN
    || hit.getDamage() <= 0) return;
  if (target.getRights() === C.core.PlayerRights.DEVELOPER && target.getAttribute(MORTAL_ATTRIBUTE) !== true) return;
  if (spoil(target)) hit.setDamage(0);
}
function attach(api) {
  api.registerNpcCombatMethodProvider(C.core.NpcIdentifiers.GHAST_7, combatClass(), { singleton: false });
  api.onCombatHitResolved(resolved);
  api.onCustomEvent("combat:damage-apply", damageApply);
  api.onCustomEvent("npc-drops:claim", claimDrops);
  api.onNpcDeath(died);
}
module.exports = { applies, prepare, reconcile, canAttack, aggression, registered, left, playerLeft, stop, attach };

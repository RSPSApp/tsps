/** Oddskull's single match-owned objective. See docs/clan-wars.md for sourced facts and TSPS policies. */
const { randomUUID } = require("crypto");
const C = require("./Common.ClanWars");
const Rules = require("./Rules.ClanWars");
const NPC_GAMEVAL = "clanwars_oddskull";
const ITEM_GAMEVAL = "clanwars_oddskull_skull";
const NPC_NAME = "<col=ff9040>Oddskull</col>";
const HOME = Object.freeze([3293, 4959, 0]);
const TOKEN = "clan-wars:oddskull-token";
const AWARD_TICKS = 4;
const RETURN_TICKS = 100;
const actors = new WeakMap(); // Retired identities remain recognised when an old walk/death callback arrives.

function applies(game) { return Rules.skullTarget(game.rules) > 0; }
function key(at) { return `${at.getX()},${at.getY()}`; }
function issued(item) { return typeof item?.getMetaValue?.(TOKEN) === "string"; }
function token(item, state) { return issued(item) && item.getMetaValue(TOKEN) === state.token; }
function fighter(game, player) {
  return player?.isPlayer?.() === true && player.isRegistered() && player.getHitpoints() > 0
    && !player.isDyingReturn() && !player.isUntargetable() && C.matches.get(player) === game
    && game.fighters.has(player) && !game.jailed.has(player) && !game.viewers.has(player)
    && player.getArea() === game.area && game.members.get(player) === game.fighters.get(player)
    && C.channel(player)?.key === game.channelKeys[game.members.get(player)];
}
function playingTile(game, at) {
  return at?.getZ() === 0 && game.area.contains(at) && game.oddskull?.playable.has(key(at));
}
function wielded(game, player) {
  const state = game.oddskull, equipment = player.getEquipment();
  const item = equipment.forSlot(C.core.Equipment.WEAPON_SLOT);
  return state?.kind === "held" && state.holder === player && item.getId() === state.itemId
    && item.getAmount() === 1 && token(item, state)
    && equipment.forSlot(C.core.Equipment.SHIELD_SLOT).getId() === -1;
}
function refresh(player) {
  C.core.EquipPacketListener.resetWeapon(player, true);
  C.core.BonusManager.update(player);
  player.getEquipment().refreshItems();
  player.getInventory().refreshItems();
  player.getUpdateFlag().flag(C.core.Flag.APPEARANCE);
}
function strip(player, predicate = issued) {
  let changed = false;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (let i = 0; i < container.getItems().length; i++) {
      if (!predicate(container.getItems()[i])) continue;
      container.setItem(i, new C.core.Item(-1, 0));
      changed = true;
    }
  }
  if (changed) refresh(player);
}
function retireActor(game) {
  const state = game.oddskull, npc = state?.npc;
  if (!npc) return;
  state.npc = null;
  const record = actors.get(npc);
  if (record) record.retired = true;
  npc.__skipDefaultRespawn = true;
  npc.getCombat().reset();
  C.api.removeNpc(npc);
  if (npc.getArea() === game.area) game.area.leave(npc, false);
}
function stop(game) {
  const state = game.oddskull;
  if (!state || state.kind === "retired") return;
  state.kind = "retired"; // Retire before actor/item removal can re-enter area callbacks.
  state.nextAward = null;
  state.returnAt = null;
  retireActor(game);
  if (state.holder) strip(state.holder);
  state.holder = null;
  for (const player of game.members.keys()) strip(player);
}
function fail(game, error) {
  if (game.oddskull) game.oddskull.failure = String(error?.message ?? error);
  for (const player of game.members.keys()) player.sendMessage("This Oddskull battle could not continue. Please try a new challenge.");
  game.finish(null);
  return false;
}
function spawn(game, at, dropped) {
  const state = game.oddskull;
  if (game.phase !== "combat" || state.kind === "retired") return false;
  retireActor(game);
  state.kind = "ground";
  state.holder = null;
  state.nextAward = null;
  state.returnAt = dropped ? C.now() + RETURN_TICKS : null;
  const npc = C.api.spawnNpc({ id: state.npcId, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
  if (!npc) return fail(game, "Oddskull spawn refused");
  state.npc = npc;
  npc.__skipDefaultRespawn = true;
  actors.set(npc, { game, state, retired: false });
  game.area.add(npc);
  registered(game, npc);
  if (npc.getArea() !== game.area || !npc.isRegistered() && !C.core.World.getAddNPCQueue().includes(npc)) {
    return fail(game, "Oddskull actor not admitted");
  }
  return true;
}
function registered(game, npc) {
  const record = actors.get(npc);
  if (record?.game !== game || record.retired || game.oddskull !== record.state
    || record.state.npc !== npc || record.state.kind !== "ground" || game.phase !== "combat") return;
  if (npc.isRegistered() && npc.getArea() === game.area && !game.area.hasMember(npc)) game.area.enter(npc);
}
function left(game, npc) {
  const record = actors.get(npc);
  if (record?.game !== game || record.retired) return;
  record.retired = true;
  npc.__skipDefaultRespawn = true;
  C.api.removeNpc(npc);
  if (game.phase !== "over") fail(game, "Owned Oddskull actor left unexpectedly");
}
function playable(game) {
  // Bounded source-template flood after barrier removal, not a nearest-tile fallback.
  const start = game.area.at(game.layout.landings[0]);
  const queue = [start], seen = new Set([key(start)]);
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = at.transform(dx, dy), k = key(next);
      if (!game.area.contains(next) || seen.has(k) || C.core.RegionManager.blocked(next, game.area)) continue;
      if (C.core.RegionManager.canMovestart(at, next, 1, 1, game.area)) { seen.add(k); queue.push(next); }
    }
  }
  if (!seen.has(key(game.area.at(HOME))) || !seen.has(key(game.area.at(game.layout.landings[1])))
    || game.layout.jails.some(tile => seen.has(key(game.area.at(tile))))) throw new Error("Oddskull middle/landing/jail geometry not qualified");
  return seen;
}
function prepare(game) {
  if (!applies(game)) return true;
  try {
    const npcId = C.core.CacheDefinitions.getNpcId(NPC_GAMEVAL);
    const itemId = C.core.CacheDefinitions.getObjId(ITEM_GAMEVAL);
    const npc = C.core.NpcDefinition.forId(npcId), item = C.core.ItemDefinition.forId(itemId);
    if (npcId == null || itemId == null || npc.getName() !== NPC_NAME || npc.getActions()[0] !== "Take"
      || npc.isAttackable() || item.getEquipmentType().getSlot() !== C.core.Equipment.WEAPON_SLOT
      || !item.isDoubleHanded() || item.isTradeable()) throw new Error("Oddskull definitions not ready");
    game.oddskull = { kind: "ground", token: `u-${randomUUID()}`, npcId, itemId,
      npc: null, holder: null, nextAward: null, returnAt: null, lastAt: null, playable: playable(game) };
    return spawn(game, game.area.at(HOME), false);
  } catch (error) { return fail(game, error); }
}
function release(game, player) {
  const state = game.oddskull;
  if (!state || state.holder !== player || state.kind !== "held") return;
  const current = player.getLocation();
  const at = player.getArea() === game.area && playingTile(game, current) ? current.clone() : state.lastAt;
  state.holder = null; // Relinquish before refresh callbacks and before death/area transitions.
  state.nextAward = null;
  strip(player);
  if (game.phase !== "combat") return;
  spawn(game, playingTile(game, at) ? at : game.area.at(HOME), true);
}
function reconcile(game) {
  const state = game.oddskull;
  if (!state || state.kind === "retired" || game.phase !== "combat") return false;
  if (state.kind === "ground") {
    const npc = state.npc, record = npc && actors.get(npc);
    if (!npc || !record || record.retired || npc.getArea() !== game.area || npc.getHitpoints() <= 0) return fail(game, "Oddskull actor lost");
    if (npc.isRegistered()) {
      if (C.core.World.getNpcs().get(npc.getIndex()) !== npc) return fail(game, "Oddskull world identity lost");
      registered(game, npc);
    } else if (!C.core.World.getAddNPCQueue().includes(npc)) return fail(game, "Oddskull queued registration refused");
    if (state.returnAt != null && C.now() >= state.returnAt) return spawn(game, game.area.at(HOME), false);
    return true;
  }
  const holder = state.holder;
  if (!holder || !wielded(game, holder)) return fail(game, "Oddskull held ownership lost");
  if (!fighter(game, holder)) { release(game, holder); return game.phase === "combat"; }
  if (!playingTile(game, holder.getLocation())) return fail(game, "Oddskull carrier outside playing component");
  state.lastAt = holder.getLocation().clone();
  // Detect cloned issued tokens; never score an ambiguous objective or reconstruct inventories.
  let count = 0;
  for (const player of game.members.keys()) for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) if (token(item, state)) count++;
  }
  if (count !== 1) return fail(game, "Duplicate Oddskull token");
  return true;
}
function tick(game) {
  if (!applies(game) || !reconcile(game)) return;
  const state = game.oddskull;
  if (state.kind !== "held" || C.now() < state.nextAward) return;
  const side = game.members.get(state.holder);
  game.points[side] += 3;
  state.nextAward = C.now() + AWARD_TICKS;
  if (game.points[side] >= Rules.skullTarget(game.rules)) game.finish(side);
}
function take({ player, npc, npcIndex }) {
  const record = actors.get(npc);
  if (!record) return false; // A same-name foreign/world actor is never ours.
  const { game, state } = record;
  if (record.retired || game.oddskull !== state || game.phase !== "combat" || !reconcile(game)
    || state.kind !== "ground" || state.npc !== npc || record.retired || !npc.isRegistered()
    || C.core.World.getNpcs().get(npcIndex) !== npc || !fighter(game, player)) return true;
  const from = player.getLocation(), to = npc.getLocation();
  if (!playingTile(game, from) || from.getZ() !== to.getZ()
    || Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY())) > 1
    || !C.core.RegionManager.canMovestart(from, to, 1, 1, game.area)) return true;
  const equipment = player.getEquipment();
  if ([C.core.Equipment.WEAPON_SLOT, C.core.Equipment.SHIELD_SLOT].some(slot => equipment.forSlot(slot).getId() !== -1)) {
    player.sendMessage("You must have both hands free to hold the skull.");
    return true;
  }
  // All predicates precede this synchronous commit; old queued callbacks retain a retired actor.
  retireActor(game);
  state.kind = "held";
  state.holder = player;
  state.lastAt = from.clone();
  state.returnAt = null;
  state.nextAward = C.now() + AWARD_TICKS;
  equipment.setItem(C.core.Equipment.WEAPON_SLOT, new C.core.Item(state.itemId, 1,
    { [TOKEN]: state.token, unbankable: true, untradeable: true }));
  player.getCombat().reset();
  player.setFollowing(null);
  refresh(player);
  return true;
}
function canAttack(game, attacker) {
  if (game.oddskull?.kind !== "held" || game.oddskull.holder !== attacker) return true;
  attacker.sendMessage("You can't fight with your hands full of skull.");
  return false;
}
function equip(event) {
  const game = C.matches.get(event.player);
  if (issued(event.item)) { event.allow = false; return; }
  if (game && [C.core.Equipment.WEAPON_SLOT, C.core.Equipment.SHIELD_SLOT].includes(event.slot)) release(game, event.player);
  // Leave allow unset: other content's permission hooks must still run.
}
function unequip(event) {
  const game = C.matches.get(event.player);
  if (game?.oddskull?.holder !== event.player || !issued(event.item)) return;
  release(game, event.player);
  event.allow = false; // Already released as NPC; never transfer to inventory.
}
function drop(event) {
  if (!issued(event.item)) return;
  event.handled = true;
  const game = C.matches.get(event.player);
  if (game?.oddskull?.holder === event.player) release(game, event.player);
  else strip(event.player);
}
function bank(event) { if (issued(event.item)) event.allow = false; }
function useItem(event) {
  const game = C.matches.get(event.player);
  // Native inventory Drop must reach ItemDropPolicy; vetoing it here consumes the click first.
  if (game?.oddskull?.itemId === event.itemId
    && !(event.action === "action" && event.option?.toLowerCase() === "drop")) event.allow = false;
}
function snapshot({ save }) {
  for (const [get, set] of [["getInventory", "setInventory"], ["getEquipment", "setEquipment"]]) {
    const items = save[get]();
    if (items) save[set](items.map(item => issued(item) ? new C.core.Item(-1, 0) : item));
  }
}
function recover({ player }) { strip(player); }
function died({ npc }) {
  const record = actors.get(npc);
  if (!record) return;
  npc.__skipDefaultRespawn = true;
  if (!record.retired && record.game.phase !== "over") fail(record.game, "Oddskull actor died");
}
function drops(event) { if (actors.has(event.npc)) event.handled = true; }
function attach(api) {
  api.onNpcInteraction(NPC_NAME, { Take: take });
  api.onCanEquip(equip);
  api.onCanUnequip(unequip);
  api.onItemDropPolicy(drop);
  api.onCanBankItem(bank);
  api.onCanUseItem(useItem);
  api.onCustomEvent("persistence:snapshot", snapshot);
  api.onPlayerLogin(recover);
  api.onNpcDeath(died);
  api.onCustomEvent("npc-drops:claim", drops);
}
module.exports = { prepare, tick, release, stop, registered, left, canAttack, attach };

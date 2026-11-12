"use strict";

const S = require("./Shared.Camdozaal");
const VAULT_RETURN_ATTRIBUTE = "camdozaal:vault-return";
const DOOR = "camdozaal_vault_door";
const HUD = 686; // cache camdozaal_vault
const DURATION = 100; // sixty seconds at 600 ms per game tick
const runs = new WeakMap();
const TIERS = [
  { name: "small", count: 6, minimum: 1, maximum: 5, firstVarbit: 12078, item: "low" },
  { name: "medium", count: 4, minimum: 2, maximum: 3, firstVarbit: 12084, item: "mid" },
  { name: "large", count: 3, minimum: 3, maximum: 3, firstVarbit: 12088, item: "high" },
];
// Current cache multilocs choose exactly one blue barrier from each group.
const BARRIERS = [
  [1, 2], [3, 4], [5, 6, 7], [8, 9, 10], [11, 12], [13, 15, 18], [17, 19],
];
function temporary(tier) { return S.obj(`camdozaal_vault_chest_${tier.item}_temporary`); }
function permanent(tier) { return S.obj(`camdozaal_vault_chest_${tier.item}`); }
function clearTemporary(player, keep) {
  const inventory = player.getInventory();
  for (const tier of TIERS) {
    const id = temporary(tier), count = inventory.getAmount(id);
    if (!count) continue;
    inventory.deleteNumber(id, count);
    if (keep) inventory.adds(permanent(tier), count);
  }
}
function returnTile(player) {
  const packed = Number(player.getAttribute(VAULT_RETURN_ATTRIBUTE)) || 0;
  return packed ? new (S.core().Location)(Math.floor(packed / 16384), packed % 16384, 0) : null;
}
function closeRun(player, keep) {
  const run = runs.get(player);
  if (!run) return;
  runs.delete(player);
  clearTemporary(player, keep);
  player.setAttribute(VAULT_RETURN_ATTRIBUTE, 0);
  player.getPacketSender().sendWalkableInterface(-1);
  if (keep) player.setRunEnergy(100);
  S.save(player);
}
function finish(player, keep) {
  const run = runs.get(player);
  if (!run) return;
  const exit = returnTile(player);
  closeRun(player, keep);
  if (exit) player.moveTo(exit);
  if (player.getArea() === run.area) run.area.leave(player, false);
  player.sendMessage(keep ? "You escape the Vault with your lockboxes." : "Your time is up! You lose the lockboxes gathered in the Vault.");
}
function layout(player) {
  const sender = player.getPacketSender();
  // Uniform group selections are a TSPS estimate; cache establishes the legal values.
  BARRIERS.forEach((group, index) => sender.sendVarbit(12069 + index, Math.floor(Math.random() * group.length)));
  for (const tier of TIERS) {
    const count = tier.minimum + Math.floor(Math.random() * (tier.maximum - tier.minimum + 1));
    const choices = Array.from({ length: tier.count }, (_, index) => index);
    for (let left = choices.length - 1; left > 0; left--) {
      const pick = Math.floor(Math.random() * (left + 1));
      [choices[left], choices[pick]] = [choices[pick], choices[left]];
    }
    for (let i = 0; i < tier.count; i++) sender.sendVarbit(tier.firstVarbit + i, choices.slice(0, count).includes(i) ? 1 : 0);
  }
}
function createArea() {
  const { PrivateArea, Boundary } = S.core();
  class Vault extends PrivateArea {
    process(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer(), run = runs.get(player);
      if (!run || player.getHitpoints() <= 0) return;
      if (++run.ticks >= DURATION) return finish(player, false);
      const seconds = Math.ceil((DURATION - run.ticks) * 0.6);
      player.getPacketSender().sendString(`Time Left: 0:${String(seconds).padStart(2, "0")}`, (HUD << 16) | 3);
    }
    canTeleport(player) {
      player.sendMessage("You can't teleport whilst inside the Vault, please return to the entrance.");
      return false;
    }
    postLeave(mobile, logout) {
      if (mobile.isPlayer()) {
        const player = mobile.getAsPlayer();
        const exit = returnTile(player);
        const stillInside = this.getBoundaries().some(boundary => boundary.inside(player.getLocation()));
        closeRun(player, false);
        // Logging out on a vault tile saves the entrance, but an already established
        // death/quest/external destination belongs to that system.
        if (logout && stillInside && exit) player.moveTo(exit);
      }
      super.postLeave(mobile, logout);
    }
  }
  return new Vault([new Boundary(2950, 2988, 5824, 5860, 0)]);
}
function door(event) {
  const { player, object } = event;
  if (event.objectId !== S.core().CacheDefinitions.getLocId(DOOR)) return false;
  if (runs.has(player)) return finish(player, true);
  if (!S.inRuins(player)) return false;
  if (!S.gate(player)) return;
  const location = object.getLocation();
  // The mapped door spans x2969-2970 at y5824. Validate both actual adjacent floor tiles.
  const entry = new (S.core().Location)(location.getX() + 1, location.getY() + 1, location.getZ());
  const exit = new (S.core().Location)(location.getX() + 1, location.getY() - 1, location.getZ());
  if (!player.getLocation().isWithinDistance(exit, 3)) return;
  if (S.core().RegionManager.blocked(entry, null) || S.core().RegionManager.blocked(exit, null)) {
    throw new Error("Camdozaal vault door floor geometry is unavailable");
  }
  if (!S.pay(player, 750, true)) return player.sendMessage("You need 750 barronite shards stored in the Sacred Forge to enter the Vault.");
  const area = createArea();
  player.setAttribute(VAULT_RETURN_ATTRIBUTE, exit.getX() * 16384 + exit.getY());
  runs.set(player, { area, ticks: 0 });
  layout(player);
  area.enter(player);
  player.moveTo(entry);
  player.getPacketSender().sendWalkableInterface(HUD).sendString("Time Left: 1:00", (HUD << 16) | 3);
  S.save(player);
}
function barrier(event) {
  const { player, object } = event;
  if (!runs.has(player)) return false;
  const id = object.getId();
  const groupIndex = BARRIERS.findIndex(group => group.some(n => S.core().CacheDefinitions.getLocId(`camdozaal_vault_barrier_${n}`) === id));
  if (groupIndex < 0) return;
  const group = BARRIERS[groupIndex];
  const selected = player.getPacketSender().getVarbit(12069 + groupIndex);
  if (id !== S.core().CacheDefinitions.getLocId(`camdozaal_vault_barrier_${group[selected]}`)) return;
  const p = player.getLocation(), o = object.getLocation();
  if (!p.isWithinDistance(o, 3)) return;
  const horizontal = (object.getFace() & 1) === 1;
  const target = horizontal
    ? new (S.core().Location)(Math.max(o.getX(), Math.min(o.getX() + 1, p.getX())), o.getY() + (p.getY() <= o.getY() ? 1 : -1), 0)
    : new (S.core().Location)(o.getX() + (p.getX() <= o.getX() ? 1 : -1), Math.max(o.getY(), Math.min(o.getY() + 1, p.getY())), 0);
  if (!S.core().RegionManager.blocked(target, player.getPrivateArea())) player.moveTo(target);
}
function take(event) {
  const { player, object } = event;
  if (!runs.has(player) || !player.getLocation().isWithinDistance(object.getLocation(), 3)) return;
  for (const tier of TIERS) for (let i = 0; i < tier.count; i++) {
    if (object.getId() !== S.core().CacheDefinitions.getLocId(`camdozaal_vault_chest_${tier.name}_${i + 1}`)) continue;
    const sender = player.getPacketSender();
    if (!sender.getVarbit(tier.firstVarbit + i)) return;
    if (!player.getInventory().getFreeSlots()) return player.sendMessage("You don't have enough inventory space.");
    player.getInventory().adds(temporary(tier), 1);
    sender.sendVarbit(tier.firstVarbit + i, 0);
    return;
  }
}
function beforeDeathItems({ player }) {
  // This existing event precedes PlayerDeathTask's kept/dropped item snapshot.
  if (runs.has(player)) clearTemporary(player, false);
}
function died({ player }) { closeRun(player, false); }
function recover({ player }) {
  const exit = returnTile(player);
  if (!exit) return;
  clearTemporary(player, false);
  player.setAttribute(VAULT_RETURN_ATTRIBUTE, 0);
  player.moveTo(exit);
  S.save(player);
}
module.exports = function attach(api) {
  api.persistAttribute(VAULT_RETURN_ATTRIBUTE, 0);
  api.onObjectInteraction("Vault Door", { Open: door });
  api.onObjectInteraction("Security Barrier", { Enter: barrier });
  api.onObjectInteraction("Simple lockbox", { Take: take });
  api.onObjectInteraction("Elaborate lockbox", { Take: take });
  api.onObjectInteraction("Ornate lockbox", { Take: take });
  api.onPlayerLogin(recover);
  api.onCustomEvent("player:death-bones", beforeDeathItems);
  api.onCustomEvent("player:died", died);
};
module.exports.inVault = player => runs.has(player);

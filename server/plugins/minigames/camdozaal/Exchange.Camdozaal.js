"use strict";

const S = require("./Shared.Camdozaal");
const FORGE_NAMES = new Set(["bim_ruins_wallkit_sacred_forge_multi", "bim_ruins_wallkit_sacred_forge_op", "bim_ruins_wallkit_sacred_forge"]);
const openAt = new WeakMap();

function forge(event) {
  const ids = [...FORGE_NAMES].map(name => S.core().CacheDefinitions.getLocId(name));
  return ids.includes(event.objectId) && S.inRuins(event.player);
}
function fuel(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (!S.gate(player)) return;
  const amount = Math.min(S.shards(player), S.MAX_SHARDS - S.stored(player));
  if (!amount) return player.sendMessage("You have no barronite shards to add, or the forge is full.");
  player.getInventory().deleteNumber(S.obj("camdozaal_barronite_shard"), amount);
  S.setStored(player, S.stored(player) + amount);
  player.sendMessage(`You add ${amount} barronite shards to the Sacred Forge.`);
  S.save(player);
}
function check(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (S.gate(player)) player.sendMessage(`You have ${S.stored(player)} barronite shards stored in the Sacred Forge.`);
}
function empty(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (!S.gate(player)) return;
  const inventory = player.getInventory();
  const amount = Math.min(S.stored(player), S.MAX_SHARDS - S.shards(player));
  if (!amount) return player.sendMessage("You have no barronite shards to withdraw.");
  const id = S.obj("camdozaal_barronite_shard");
  if (inventory.getFreeSlots() === 0 && !inventory.contains(id)) return player.sendMessage("You don't have enough inventory space.");
  inventory.adds(id, amount);
  S.setStored(player, S.stored(player) - amount);
  S.save(player);
}
function useShard(event) {
  if (event.handled || event.itemId !== S.obj("camdozaal_barronite_shard") || !forge(event)) return;
  event.handled = true;
  fuel(event);
}
function open({ player, npc }) {
  if (!S.inRuins(player)) return false;
  if (!S.gate(player)) return;
  S.sync(player);
  openAt.set(player, npc?.getLocation().clone() ?? player.getLocation().clone());
  player.getPacketSender().sendInterface(S.SHOP);
  for (const buff of S.BUFFS) player.getPacketSender().sendInterfaceFlagsRange((S.SHOP << 16) | buff.component, -1, -1, 2);
  return true;
}
function buy(event) {
  const { player } = event;
  const uid = event.buttonId;
  const index = S.BUFFS.findIndex(b => ((S.SHOP << 16) | b.component) === uid);
  const origin = openAt.get(player);
  if (index < 0 || player.getInterfaceId() !== S.SHOP || !origin || !player.getLocation().isWithinDistance(origin, 3) || !S.unlocked(player)) return;
  if (index < 5 && S.purchased(player, index)) return player.sendMessage("That buff is already active.");
  if (index === 5 && S.boostTicks(player) > 0) return player.sendMessage("Your boost is already active.");
  const buff = S.BUFFS[index];
  if (!S.pay(player, buff.cost)) return player.sendMessage("You don't have enough barronite shards.");
  if (index < 5) player.setAttribute(S.BUFFS_ATTRIBUTE, S.flags(player) | (1 << index));
  else player.setAttribute(S.BOOST_ATTRIBUTE, Date.now() + 60 * 60 * 1000);
  S.sync(player);
  S.save(player);
}
function closed({ player, interfaceId }) { if (interfaceId === S.SHOP) openAt.delete(player); }
function login({ player }) { S.sync(player); }
function logout({ player }) { openAt.delete(player); }

module.exports = function attach(api) {
  api.persistAttribute(S.STORED_ATTRIBUTE, 0);
  api.persistAttribute(S.BUFFS_ATTRIBUTE, 0);
  api.persistAttribute(S.BOOST_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onNpcInteraction("Ramarno", { Exchange: open });
  api.onObjectInteraction("Sacred Forge", { Fuel: fuel, Check: check, Empty: empty });
  api.onItemOnObject(useShard);
  api.onInterfaceActionButton((S.SHOP << 16) | 3, buy);
  api.onInterfaceActionButton((S.SHOP << 16) | 4, buy);
  api.onInterfaceActionButton((S.SHOP << 16) | 6, buy);
  api.onInterfaceActionButton((S.SHOP << 16) | 8, buy);
  api.onInterfaceActionButton((S.SHOP << 16) | 10, buy);
  api.onInterfaceActionButton((S.SHOP << 16) | 12, buy);
  api.onCustomEvent("interface:closed", closed);
};

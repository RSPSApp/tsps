"use strict";

const S = require("./Shared.Camdozaal");
const FORGE_NAMES = new Set(["bim_ruins_wallkit_sacred_forge_multi", "bim_ruins_wallkit_sacred_forge_op", "bim_ruins_wallkit_sacred_forge"]);
const openAt = new WeakMap();
/** Synth sounds from rsprox 2026-11-17: a refused purchase, and the Boost bought. */
const REFUSED_SOUND = 2277;
const BOUGHT_SOUND = 4974;

function forge(event) {
  const ids = [...FORGE_NAMES].map(name => S.core().CacheDefinitions.getLocId(name));
  return ids.includes(event.objectId) && S.inRuins(event.player);
}
// Fuel, Check and Empty follow rsprox 2026-11-17 (rev 242.1): Fuel and Empty ask for an
// amount (clientscript 108) naming the stored total, then report the result.
function fuel(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (!S.gate(player)) return;
  if (!S.shards(player)) return player.sendMessage("You have no Barronite shards to deposit.");
  S.askAmount(player, `How many Barronite shards would you like to deposit?<br>${S.format(S.stored(player))} stored.`, count => {
    const amount = S.store(player, count);
    if (amount) player.sendMessage(`You stored ${S.format(amount)} Barronite shards in the Sacred Forge.`);
  });
}
function check(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (S.gate(player)) player.sendMessage(`You currently have ${S.format(S.stored(player))} Barronite shards stored`);
}
function empty(event) {
  const { player } = event;
  if (!forge(event)) return false;
  if (!S.gate(player)) return;
  if (!S.stored(player)) return player.sendMessage("You have no Barronite shards to withdraw.");
  S.askAmount(player, `How many Barronite shards would you like to withdraw?<br>${S.format(S.stored(player))} stored.`, count => {
    if (S.withdraw(player, count)) player.sendMessage(`You have ${S.format(S.stored(player))} Barronite shards left in the Sacred Forge.`);
  });
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
  if (!S.pay(player, buff.cost)) {
    player.getPacketSender().sendSound(REFUSED_SOUND, 1, 0);
    return player.sendMessage("You cannot afford that buff at this time.");
  }
  if (index < 5) player.setAttribute(S.BUFFS_ATTRIBUTE, S.flags(player) | (1 << index));
  else player.setAttribute(S.BOOST_ATTRIBUTE, Date.now() + 60 * 60 * 1000);
  player.getPacketSender().sendSound(BOUGHT_SOUND, 1, 0);
  S.sync(player);
  S.save(player);
}
function closed({ player, interfaceId }) { if (interfaceId === S.SHOP) openAt.delete(player); }
function login({ player }) { S.sync(player); }
function logout({ player }) { openAt.delete(player); }

module.exports = attach;
module.exports.open = open;
function attach(api) {
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
}

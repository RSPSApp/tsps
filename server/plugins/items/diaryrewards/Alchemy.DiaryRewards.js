const Common = require("./Common.DiaryRewards");
const Daily = require("./DailyRing.DiaryRewards");
const SELECTION_ATTRIBUTE = "diary-rewards:alchemy-high";
const SESSIONS = new WeakMap();
const GENERATIONS = new WeakMap();
const SOURCE = Symbol("ring-alchemy");
const group = () => Common.core.CacheDefinitions.getInterfaceId("lumbridge_alchemy");
const uid = name => Common.core.CacheDefinitions.getComponentId("lumbridge_alchemy:" + name);
const host = () => Common.core.CacheDefinitions.getComponentId("toplevel_osrs_stretch:side3");
const bit = name => Common.core.CacheDefinitions.getVarbitId(name);
const tierFor = id => Common.DATA.explorersRing.objs.findIndex(name => Common.objId(name) === id);
function generation(player) {
  if (!GENERATIONS.has(player)) GENERATIONS.set(player, {});
  return GENERATIONS.get(player);
}
function held(player, item) {
  return item.getAmount() > 0 && (player.getInventory().getItems().includes(item) || player.getEquipment().getItems().includes(item));
}
function ready(player) {
  return player.isRegistered() && player.getHitpoints() > 0 &&
    player.getStatus() === Common.core.PlayerStatus.NONE && !player.busy() &&
    !player.isTeleportingReturn() && !player.getForceMovement();
}
function valid(player, session) {
  return ready(player) && session.generation === generation(player) && held(player, session.ring) &&
    tierFor(session.ring.getId()) === session.tier &&
    (!session.panel || (SESSIONS.get(player) === session && player.getPacketSender().isSubInterfaceOpen(group())));
}
function selection(player, tier) {
  return tier === 3 && player.getAttribute(SELECTION_ATTRIBUTE) === true;
}
function sync(player, tier) {
  player.getPacketSender().sendVarbit(bit("lumbridge_alchemy_high"), selection(player, tier) ? 1 : 0);
  Common.sendCount(player, bit("lumbridge_free_alchs"), Daily.uses(player, Daily.ALCHEMY_KEY));
}
function open(event, tier) {
  const {player, item} = event;
  if (!ready(player) || !item || !held(player, item) || tierFor(item.getId()) !== tier) return;
  const session = {ring: item, tier, panel: true, generation: generation(player)};
  SESSIONS.set(player, session);
  const sender = player.getPacketSender();
  sync(player, tier);
  sender.sendSubInterface(host(), group(), 1);
  sender.sendInterfaceFlagsRange(uid("items"), 0, 27, (1 << 1) | (1 << 10));
  for (const name of ["low", "high", "close"]) sender.sendInterfaceFlagsRange(uid(name), -1, -1, 1 << 1);
  player.getInventory().refreshItems();
  sender.sendTab(3);
}
function close(player) {
  SESSIONS.delete(player);
  player.getPacketSender().sendSubInterface(host(), Common.core.CacheDefinitions.getInterfaceId("inventory"), 1);
  player.getInventory().refreshItems();
}
function cast(player, session, slot, itemId) {
  if (!valid(player, session) || !Number.isInteger(slot) || slot < 0 || slot >= 28) return;
  const item = player.getInventory().forSlot(slot);
  if (!item || item.getId() !== itemId) return;
  if (tierFor(itemId) >= 0) {
    player.sendMessage("It feels wrong to use the ring's power on this item.");
    return;
  }
  Common.core.castAlchemy(player, selection(player, session.tier) ? "High Level Alchemy" : "Low Level Alchemy",
    itemId, slot, {kind: SOURCE, session});
}
function click(event) {
  if (event.buttonId >>> 16 !== group()) return;
  event.handled = true;
  const {player, buttonId, action, slot, itemId} = event, session = SESSIONS.get(player);
  // Close always closes, even once the ring that opened the panel has gone (banked, or banked and withdrawn as a
  // new object): otherwise the panel stays in the inventory's place with nothing to take it down.
  if (buttonId === uid("close")) {
    if (action === 1) close(player);
    return;
  }
  if (!session || !valid(player, session)) return;
  if (buttonId === uid("low") || buttonId === uid("high")) {
    if (action !== 1) return;
    const high = buttonId === uid("high");
    if (high && session.tier < 3) {
      player.sendMessage("You need the elite explorer ring to do that.");
      return;
    }
    player.setAttribute(SELECTION_ATTRIBUTE, high);
    sync(player, session.tier);
    Common.api.emitCustomEvent("persistence:save", {player, reason: "explorers-ring-alchemy-selection"});
  } else if (buttonId === uid("items")) {
    if (action === 1) cast(player, session, slot, itemId);
    else if (action === 10 && Number.isInteger(slot) && slot >= 0 && slot < 28) {
      const item = player.getInventory().forSlot(slot);
      if (item?.getId() === itemId) player.sendMessage(item.getDefinition().getExamine());
    }
  }
}
function capacity(player, item, slot, coins) {
  const plan = new Common.core.Inventory(player);
  plan.getItems().splice(0, 28, ...player.getInventory().getItems().map(i => i.clone()));
  plan.deleteAtSlot(slot, 1, false);
  return plan.getAddableAmount(new Common.core.Item(Common.core.ItemIdentifiers.COINS, coins)) >= coins;
}
function payment(event) {
  const {player, source, itemId, item, slot} = event;
  const dedicated = source?.kind === SOURCE;
  if (!dedicated && event.hasRunes) return;
  let session = dedicated ? source.session : null;
  if (!dedicated) {
    const rings = [...player.getInventory().getItems(), ...player.getEquipment().getItems()]
      .map(ring => ({ring, tier: tierFor(ring.getId()), panel: false, generation: generation(player)})).filter(s => s.tier >= 0);
    session = rings.sort((a,b) => b.tier-a.tier)[0];
  }
  if (!session) return;
  if (dedicated) event.allowed = false;
  if (!valid(player, session) || tierFor(itemId) >= 0) return;
  if (event.high && session.tier < 3) return;
  if (Daily.uses(player, Daily.ALCHEMY_KEY) >= Common.DATA.explorersRing.alchemyPerDay) {
    player.sendMessage("You have used all of your alchemy charges for today.");
    return;
  }
  if (!capacity(player, item, slot, event.coins)) {
    player.getInventory().full();
    return;
  }
  event.allowed = true;
  event.free = true;
  event.experience = 0;
  event.allowAnySpellbook = dedicated;
  event.keepTab = dedicated && session.panel;
  event.validate = () => valid(player, session) && player.getInventory().forSlot(slot) === item &&
    Daily.uses(player, Daily.ALCHEMY_KEY) < Common.DATA.explorersRing.alchemyPerDay;
  event.commit = () => {
    Daily.use(player, Daily.ALCHEMY_KEY);
    sync(player, session.tier);
  };
}
function itemOnRing(event) {
  const {player} = event;
  const usedTier = tierFor(event.usedItemId), withTier = tierFor(event.usedWithItemId);
  if (usedTier < 0 && withTier < 0) return;
  event.handled = true;
  const ring = usedTier >= 0 ? event.usedItem : event.usedWithItem;
  const item = usedTier >= 0 ? event.usedWithItem : event.usedItem;
  const slot = usedTier >= 0 ? event.usedWithItemSlot : event.usedItemSlot;
  const session = {ring, tier: tierFor(ring.getId()), panel: false, generation: generation(player)};
  if (!valid(player, session) || player.getInventory().forSlot(slot) !== item) return;
  const proceed = () => {
    player.getPacketSender().sendInterfaceRemoval();
    if (player.getInventory().forSlot(slot) === item) cast(player, session, slot, item.getId());
  };
  if (player.getPacketSender().getVarbit(bit("alchemy_warning_forinventory_disabled")) === 1) return proceed();
  Common.api.sendMultiChatboxPrompt(player, "Alchemise this item using your ring?", "Proceed", proceed, "Cancel", () => player.getPacketSender().sendInterfaceRemoval());
}
function logout({player}) { SESSIONS.delete(player); GENERATIONS.delete(player); }
function login({player}) { sync(player, 3); }
function attach(api) {
  api.persistAttribute(SELECTION_ATTRIBUTE, false);
  api.onInterfaceActionClick(click);
  api.onCustomEvent("magic:alchemy-payment", payment);
  api.onItemOnItem(itemOnRing);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
}
module.exports = {attach, open};

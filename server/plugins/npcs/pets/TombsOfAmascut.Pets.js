// Tumeken's guardian's Metamorphosis (Wiki: Tumeken's guardian). rsprox 1757 (rev 227) ticks 26423-26425: it is a
// menu, interface 187 with script 217 ("Choose metamorph", the eight forms in this order, locked ones grey, true),
// and the choice arrives as the interface's resume packet (sub = the index): choosing Zebo (5) turned Tumeken's
// guardian straight into Zebo. Tumeken's and Elidinis' guardian are always open (Wiki: "by default"); the others
// need the unlock a remnant gives when it is used on the pet (Items.TombsOfAmascut keeps the varbits in the
// persisted "toa:pet-morphs"). What a click on a grey form does is not captured; it is refused here.
let api, services;
const UNLOCKS_ATTRIBUTE = "toa:pet-morphs";
const MENU_SCRIPT = 217; // menu(string title, string entries, boolean keyboard), as RiftGuardian.Pets.js.
const GREY = "858585";
/** The menu's entries in the captured order; `varbit` is TOA_UNLOCKED_PET_MORPH_* (14498-14503), none for the defaults. */
const FORMS = [
  {petId: 11812, name: "Tumeken's guardian"},
  {petId: 11813, name: "Elidinis' guardian"},
  {petId: 11846, name: "Akkhito", varbit: 14498},
  {petId: 11847, name: "Babi", varbit: 14499},
  {petId: 11848, name: "Kephriti", varbit: 14500},
  {petId: 11849, name: "Zebo", varbit: 14501},
  {petId: 11850, name: "Tumeken's damaged guardian", varbit: 14502},
  {petId: 11851, name: "Elidinis' damaged guardian", varbit: 14503},
];
const pendingMenus = new WeakMap();
const formOf = petId => FORMS.find(form => form.petId === petId);
function unlocked(player, form) {
  if (form.varbit === undefined) return true;
  const list = player.getAttribute(UNLOCKS_ATTRIBUTE);
  return Array.isArray(list) && list.includes(form.varbit);
}
function current(player, npc = player?.getAttribute?.(services.currentAttribute)) {
  if (player?.isRegistered?.() !== true || npc?.isRegistered?.() !== true
      || npc.isPet?.() !== true || npc.isVisible?.() !== true || npc.getOwner?.() !== player
      || player.getAttribute(services.currentAttribute) !== npc
      || services.world.getRemoveNPCQueue?.().includes(npc)) return null;
  const pet = services.getPetByNpcId(npc.getId());
  return pet && formOf(pet.petId) ? {npc, pet} : null;
}
function openMenu(player, npc) {
  const follower = current(player, npc);
  if (!follower || player.busy()) return;
  const cache = api.core.CacheDefinitions, sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendInterface(cache.getInterfaceId("menu"));
  sender.sendClientScript(MENU_SCRIPT, 1, "Choose metamorph",
    FORMS.map(form => unlocked(player, form) ? form.name : `<col=${GREY}>${form.name}</col>`).join("|"));
  sender.sendInterfaceFlagsRange(cache.getComponentId("menu:lj_layer1"), 0, FORMS.length - 1, 1);
  pendingMenus.set(player, {npc, petId: follower.pet.petId});
}
function chooseForm(event) {
  const component = api.core.CacheDefinitions.getComponentId("menu:lj_layer1");
  if (event.groupId !== component >>> 16 || event.childId !== (component & 65535)) return;
  const context = pendingMenus.get(event.player);
  if (!context) return;
  event.handled = true;
  pendingMenus.delete(event.player);
  const player = event.player;
  if (player.getInterfaceId() !== api.core.CacheDefinitions.getInterfaceId("menu")) return;
  // Validate before closing: closing a modal can reset status, including a trade.
  if (player.getHitpoints() <= 0 || player.isDyingReturn() || player.getStatus() !== api.core.PlayerStatus.NONE
      || player.isNeedsPlacement() || player.isTeleportingReturn() || player.getForceMovement()) return;
  player.getPacketSender().sendInterfaceRemoval();
  const follower = current(player, context.npc), index = event.slot ?? event.action;
  const next = Number.isInteger(index) ? FORMS[index] : null;
  if (!follower || follower.pet.petId !== context.petId || player.busy() || !next || !unlocked(player, next)) return;
  if (next.petId === follower.pet.petId) return;
  const target = services.getPetByNpcId(next.petId);
  follower.npc.setNpcTransformationId(next.petId);
  services.setStoredVariant(player, follower.pet, next.petId);
  player.setAttribute(services.activeAttribute, target.itemId);
  player.setAttribute(services.lastAttribute, target.itemId);
  api.emitCustomEvent("persistence:save", {player, reason: "toa-pet-metamorphosis"});
}
function closeMenu({player}) { pendingMenus.delete(player); }
function closedInterface({player, interfaceId}) {
  if (interfaceId === api.core.CacheDefinitions.getInterfaceId("menu")) pendingMenus.delete(player);
}
function interact(event) {
  if (event.handled || !formOf(event.pet?.petId)) return;
  if (String(event.action).toLowerCase() !== "metamorphosis") return;
  event.handled = true;
  openMenu(event.player, event.npc);
}
function attach(pluginApi, helpers) {
  api = pluginApi; services = helpers;
  api.onCustomEvent("pets:interact", interact);
  api.onInterfaceActionClick(chooseForm);
  api.onCustomEvent("interface:close", closeMenu);
  api.onCustomEvent("interface:closed", closedInterface);
  api.onPlayerLogout(closeMenu);
  api.onPlayerDeath(closeMenu);
}
module.exports = {attach, FORMS};

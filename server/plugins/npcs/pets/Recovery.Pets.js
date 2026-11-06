// Cache241: pet_insurance148, init6126, enum985; three31-bit masks/nine4-bit location packs.
const PET_ENUM = 985, INIT_SCRIPT = 6126, ROW_START = 6, ROW_STRIDE = 5;
const CURRENT_PET_ATTRIBUTE = "pets:current";
const SESSIONS = new WeakMap(), PENDING = new WeakMap();
let api, core, services;
const group = () => core.CacheDefinitions.getInterfaceId("pet_insurance");
const uid = name => core.CacheDefinitions.getComponentId("pet_insurance:" + name);
const bit = name => core.CacheDefinitions.getVarbitId("pet_insurance_" + name);
const varp = name => core.CacheDefinitions.getVarpId("pet_insurance_" + name);
function safe(player, context) {
  return player.isRegistered() && player.getHitpoints() > 0 &&
    player.getStatus() === core.PlayerStatus.NONE && !player.isNeedsPlacement() &&
    !player.isTeleportingReturn() && !player.getForceMovement() && !player.getCombat().getAttacker() &&
    context.npc.isRegistered() && context.npc.getId() === core.NpcIdentifiers.PROBITA &&
    player.getPrivateArea() === context.area && context.npc.getPrivateArea() === context.area &&
    player.getLocation().isWithinDistance(context.origin, 0) &&
    player.getLocation().isWithinDistance(context.npc.getLocation(), 3);
}
function current(player) {
  const context = SESSIONS.get(player);
  return context && safe(player, context) && player.getInterfaceId() === group() &&
    player.getPacketSender().isSubInterfaceOpen(group()) ? context : null;
}
function familyOf(id) {
  const pet = services.getPetForItemId(id);
  return pet && pet.reclaimable !== false ? services.petFamily(pet) : null;
}
function locationOf(player, family) {
  const variants = services.pets.filter(p => familyOf(p.itemId) === family);
  const active = player.getAttribute(CURRENT_PET_ATTRIBUTE);
  if (active?.isRegistered() && variants.some(p => p.petId === active.getId())) return 3;
  if (variants.some(p => player.getInventory().contains(p.itemId))) return 2;
  if (variants.some(p => player.getBanks().some((bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX && bank?.contains(p.itemId)))) return 1;
  for (const pet of variants) {
    const request = {player, itemId: pet.itemId, held: false};
    api.emitCustomEvent("pets:held-elsewhere", request);
    if (request.held) return 4;
  }
  return 0;
}
function rows(player) {
  const owned = new Map(), result = new Map();
  for (const id of services.getOwnedPetItems(player)) {
    const family = familyOf(id);
    if (family) owned.set(family, id);
  }
  for (const [index, id] of core.CacheDefinitions.getEnumValues(PET_ENUM)) {
    const family = familyOf(id), stored = owned.get(family);
    if (Number.isInteger(index) && index >= 0 && index < 72 && stored !== undefined)
      result.set(index, {index, family, itemId: stored, location: locationOf(player, family)});
  }
  return result;
}
function sync(player, context) {
  const all = rows(player), found = [0,0,0], held = [0,0,0], places = Array(9).fill(0);
  context.rows = all;
  for (const row of all.values()) {
    const part = Math.floor(row.index / 31), mask = 1 << (row.index % 31);
    found[part] |= mask;
    if (row.location) held[part] |= mask;
    places[Math.floor(row.index / 8)] |= row.location << ((row.index % 8) * 4);
  }
  const sender = player.getPacketSender();
  for (let i=0;i<3;i++) {
    sender.sendConfig(varp("bitmask"+(i+1)), found[i]);
    sender.sendConfig(varp("owned_bitmask"+(i+1)), held[i]);
  }
  sender.sendVarbit(bit("reclaim"), context.selected == null ? 0 : context.selected.index + 1);
  sender.sendVarbit(bit("credits"), 0);
  sender.sendVarbit(bit("discounted"), 0);
  sender.sendClientScript(INIT_SCRIPT, ...found, ...held, ...places);
  sender.sendInterfaceFlagsRange(uid("pets"), 0, ROW_START + ROW_STRIDE * 72 * 2 - 1, (1<<1)|(1<<10));
  sender.sendInterfaceFlagsRange(uid("confirm_click"), 0, 0, 1<<1);
}
function openNow(player, context) {
  if (PENDING.get(player) !== context || !safe(player, context)) return;
  const request = {player, feature: "pet-recovery", resume: () => openNow(player, context)};
  api.emitCustomEvent("bank-pin:guard", request);
  if (request.locked || !safe(player, context)) return;
  PENDING.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  SESSIONS.set(player, context);
  player.getPacketSender().sendInterface(group());
  sync(player, context);
  if (context.area === null) {
    api.emitCustomEvent("diary:task", {
      player,
      diary: "ardougne",
      task: "check-what-pets-you-have-insured-with-probita-in",
    });
  }
}
function open(event) {
  const {player, npc} = event;
  if (!player || !npc) return;
  const context = {npc, origin: player.getLocation().clone(), area: player.getPrivateArea(), selected: null};
  if (!safe(player, context)) return;
  PENDING.set(player, context);
  // The transcript's terminal action closes its chat after dispatch; open next tick.
  const task = new core.Task(1, player.getIndex(), false);
  task.execute = function openRecoveryAfterDialogue() { this.stop(); openNow(player, context); };
  core.TaskManager.submit(task);
}
function check(event) { open(event); return true; }
function confirm(player, context) {
  if (current(player) !== context || !context.selected) return;
  // A newly active PIN replaces the modal. Retain only this identity-bound request;
  // after unlock reopen it, then recheck live ownership/possession/capacity below.
  PENDING.set(player, context);
  const request = {player, feature: "pet-recovery", resume: () => resumeConfirmation(player, context)};
  api.emitCustomEvent("bank-pin:guard", request);
  if (request.locked || current(player) !== context) return;
  PENDING.delete(player);
  const selected = context.selected, live = rows(player).get(selected.index);
  if (!live || live.family !== selected.family || live.itemId !== selected.itemId || live.location) {
    context.selected = null; sync(player, context); return;
  }
  const item = new core.Item(live.itemId);
  if (player.getInventory().getAddableAmount(item) < 1) {
    player.sendMessage("You need more inventory space to reclaim your pet."); return;
  }
  context.selected = null;
  player.getInventory().add(item, true);
  player.sendMessage(`Probita returns your ${services.getPetDisplayName(services.getPetForItemId(live.itemId))}.`);
  services.syncCollectionLog(player);
  api.emitCustomEvent("persistence:save", {player, reason: "pet-retrieval"});
  sync(player, context);
}
function resumeConfirmation(player, context) {
  if (PENDING.get(player) !== context) return;
  openNow(player, context);
  confirm(player, context);
}
function click(event) {
  const {player, buttonId, slot, action} = event;
  if (buttonId >>> 16 !== group()) return;
  event.handled = true;
  const context = current(player);
  if (!context) return;
  if (buttonId === uid("pets") && action === 10 && Number.isInteger(slot)) {
    const missing = [...context.rows.values()].some(row => !row.location);
    const lostIndex = (slot - ROW_START) / ROW_STRIDE;
    const heldIndex = (slot - ROW_START - (missing ? ROW_STRIDE * 72 : 0)) / ROW_STRIDE;
    const lost = Number.isInteger(lostIndex) && context.rows.get(lostIndex);
    const held = Number.isInteger(heldIndex) && context.rows.get(heldIndex);
    const row = lost && !lost.location ? lost : held?.location ? held : null;
    if (row) player.sendMessage(core.ItemDefinition.forId(row.itemId).getExamine());
    return;
  }
  if (action !== 1) return;
  if (buttonId === uid("frame") && slot === 11) { player.getPacketSender().sendInterfaceRemoval(); return; }
  if (buttonId === uid("confirm_click") && slot === 0) { confirm(player, context); return; }
  if (buttonId !== uid("pets") || !Number.isInteger(slot)) return;
  const index = (slot - ROW_START) / ROW_STRIDE;
  if (!Number.isInteger(index)) return;
  const row = context.rows.get(index);
  if (!row || row.location) return;
  context.selected = row;
  sync(player, context);
}
function closed({player, interfaceId}) { if (interfaceId === group()) SESSIONS.delete(player); }
function logout({player}) { SESSIONS.delete(player); PENDING.delete(player); }
function attach(pluginApi, helpers) {
  api = pluginApi; core = api.core; services = helpers;
  api.onInterfaceActionClick(click);
  api.onNpcInteraction("Probita", {Check: check});
  api.onCustomEvent("interface:closed", closed);
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(logout);
}
module.exports = {attach, open};

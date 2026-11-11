/**
 * The sceptre's options (Wiki: Pharaoh's_sceptre):
 * - Teleport: a choice of the great pyramids, as the ring of dueling asks (its sub-options go
 *   straight to one); Last-Teleport: the previous one, Jalsavrah before any; worn, each pyramid
 *   is its own option. Each teleport spends a charge on arrival, and the last one leaves the
 *   uncharged sceptre. They work up to level 30 Wilderness.
 * - Jaltevas needs the Necropolis obelisk communed with, the sceptre in the pack (charged or not).
 * - Check: the charges left. Uncharge: the charges gone, the sceptre uncharged.
 */
const Common = require("./Common.PharaohsSceptre");

const WORN_OPTION_PARAM = 451;
/** Equipment clicks: op 1 removes the item, op 2 onwards are the worn options. */
const FIRST_WORN_OPTION_CLICK = 2;

const normalise = (text) => String(text ?? "").toLowerCase().trim();

let sceptreTeleport = null;

/**
 * The recorded teleport: ntk_human_tele and ntk_tele, no sound (`sound: 0` skips the spell
 * sound), the move `teleportTicks` later, the end animation then and again a tick after.
 */
function teleportType() {
  if (sceptreTeleport) return sceptreTeleport;
  const { core, data } = Common;
  const seq = core.CacheDefinitions.getSeqId(data.names.seqs.teleport);
  const spotanim = core.CacheDefinitions.getSpotanimId(data.names.spotanims.teleport);
  sceptreTeleport = new core.TeleportType(
    data.teleportTicks,
    new core.Animation(seq, core.Priority.HIGH),
    null,
    core.Animation.DEFAULT_RESET_ANIMATION,
    new core.Graphic(spotanim, core.Priority.HIGH),
    null,
    null,
    { sound: 0, repeatEndAnimation: true },
  );
  return sceptreTeleport;
}

function destinations(player) {
  return Common.data.destinations.filter((destination) => !destination.needsNecropolis || Common.necropolisUnlocked(player));
}

function destinationNamed(name) {
  const wanted = normalise(name);
  return Common.data.destinations.find((destination) => normalise(destination.name) === wanted) ?? null;
}

/** The destination last used, or Jalsavrah before any (Wiki). */
function lastDestination(player) {
  const number = Number(player.getAttribute(Common.LAST_ATTRIBUTE)) || 0;
  return Common.data.destinations[number - 1] ?? Common.data.destinations[0];
}

/** Casts to `destination`, spending a charge on arrival. False if refused. */
function teleport(player, destination) {
  const { core } = Common;
  const found = Common.findSceptre(player, Common.chargedIds());
  if (!found || Common.charges(player) <= 0) {
    player.sendMessage(Common.message("noCharges"));
    return false;
  }
  if (destination.needsNecropolis && !Common.necropolisUnlocked(player)) {
    player.sendMessage(Common.message("needNecropolis"));
    return false;
  }
  const [x, y, z] = destination.tile;
  const target = new core.Location(x, y, z);
  if (!core.TeleportHandler.checkReqs(player, target, Common.data.wildernessLevel)) return false;
  core.TeleportHandler.confirm(player, target,
    () => core.TeleportHandler.teleport(player, target, teleportType(), false, () => spendCharge(player, destination)), Common.data.wildernessLevel);
  return true;
}

function spendCharge(player, destination) {
  const left = Math.max(0, Common.charges(player) - 1);
  player.setAttribute(Common.LAST_ATTRIBUTE, Common.data.destinations.indexOf(destination) + 1);
  Common.setCharges(player, left);
  // Recorded: a teleport says nothing while charges are left.
  if (left > 0) return;
  const found = Common.findSceptre(player, Common.chargedIds());
  if (found) Common.swapSceptre(player, found, Common.ids.objs.uncharged);
  player.sendMessage(Common.message("empty"));
}

/** The choice of pyramids (the unlocked ones). */
function chooseDestination(player) {
  if (Common.charges(player) <= 0) {
    player.sendMessage(Common.message("noCharges"));
    return;
  }
  const options = destinations(player).flatMap((destination) => [destination.name, () => teleport(player, destination)]);
  Common.api.sendMultiChatboxPrompt(player, Common.message("prompt"), ...options);
}

function check(player, itemId) {
  const count = Common.chargesOf(player, itemId);
  player.sendMessage(count > 0 ? Common.message("check", Common.chargeWords(count)) : Common.message("checkEmpty"));
}

function uncharge(player) {
  const count = Common.charges(player);
  const confirm = () => {
    const found = Common.findSceptre(player, Common.chargedIds());
    if (!found) return;
    Common.swapSceptre(player, found, Common.ids.objs.uncharged);
    Common.setCharges(player, 0);
    player.sendMessage(Common.message("uncharged"));
  };
  Common.api.sendMultiChatboxPrompt(player, Common.message("unchargeConfirm", Common.chargeWords(count)),
    "Yes", confirm, "No", () => {});
}

function wornOptionName(itemId, clickType) {
  const index = clickType - FIRST_WORN_OPTION_CLICK;
  if (index < 0) return null;
  return Common.core.CacheDefinitions.getItem(itemId)?.params?.get?.(WORN_OPTION_PARAM + index) ?? null;
}

function onItemAction(event) {
  if (!Common.isSceptre(event.itemId) || !event.item) return;
  const { player } = event;
  const equipped = event.interfaceId === Common.core.Equipment.INVENTORY_INTERFACE_ID;
  const option = normalise(equipped ? (event.option ?? wornOptionName(event.itemId, event.clickType)) : event.option);
  if (option === "check") {
    event.handled = true;
    check(player, event.itemId);
    return;
  }
  if (!Common.isCharged(event.itemId)) return;
  // Teleport's sub-options name the pyramid in order.
  if (Number.isInteger(event.subOpId) && option === "teleport") {
    const destination = Common.data.destinations[event.subOpId - 1];
    if (destination) {
      event.handled = true;
      teleport(player, destination);
    }
    return;
  }
  const named = destinationNamed(option);
  if (named) {
    event.handled = true;
    teleport(player, named);
    return;
  }
  if (option === "teleport") {
    event.handled = true;
    chooseDestination(player);
  } else if (option === "last-teleport") {
    event.handled = true;
    teleport(player, lastDestination(player));
  } else if (option === "uncharge") {
    event.handled = true;
    uncharge(player);
  }
}

/** The Necropolis obelisk: communing with a sceptre in the pack opens Jaltevas for it (Wiki). */
function commune({ player, objectId }) {
  if (objectId !== Common.ids.locs.obelisk) return false;
  const inPack = (player.getInventory?.()?.getItems?.() ?? []).some((item) => Common.isSceptre(item?.getId?.()));
  if (!inPack) return false;
  if (!Common.necropolisUnlocked(player)) {
    player.setAttribute(Common.NECROPOLIS_ATTRIBUTE, true);
    Common.sync(player);
  }
  player.sendMessage(Common.message("communed"));
  return true;
}

function attach(api) {
  api.onItemAction(onItemAction);
  api.onObjectInteraction("Obelisk", { Commune: commune });
}

module.exports = { attach, onItemAction, teleport, spendCharge, chooseDestination, check, uncharge, commune, lastDestination, destinations };

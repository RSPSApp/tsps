// Hand cargo only. Wiki: teleport confiscation, a 22-tick grace period outside port,
// and no manual removal/helm/Trim while carrying. See docs/port-tasks.md for sources
// and the explicitly approximate TSPS port envelope.
const common = require("./Common.PortTasks");
const Cargo = require("../Cargo.Sailing");

const GRACE_TICKS = 22;
const LEAVING = "You're leaving port with some cargo. If you do not return it, it will be confiscated by the shipwright wizard's autonomous tracking unit.";
const CONFISCATED = "Your cargo has been confiscated by the S.W.A.T. team.";
const HANDS_FULL = "You can't do that while you're holding cargo in your hands.";
const CANNOT_REMOVE = "You can't remove the cargo. You'll need to find a safe place to put it down first.";
const watches = new WeakMap();

/** Resolve old saves only when exactly one outstanding task owns this crate. */
function carriedSlot(player, crate) {
  const slots = common.slots(player);
  const owns = (slot) => slot && common.taskById(slot.id)?.crate === crate && slot.taken > slot.delivered;
  const saved = player.getAttribute(common.CARRIED_SLOT_ATTRIBUTE);
  if (Number.isInteger(saved) && owns(slots[saved])) return saved;
  const matches = slots.flatMap((slot, index) => owns(slot) ? [index] : []);
  return matches.length === 1 ? matches[0] : -1;
}

function forget({ player }) {
  const watch = watches.get(player);
  if (watch) watch.task.stop();
  watches.delete(player);
}

/** Return just the confiscated hand crate to collection; crew and hold remain owned there. */
function confiscate(player) {
  const crate = common.heldCrate(player);
  if (crate === undefined) return;
  const index = carriedSlot(player, crate);
  const slots = common.slots(player);
  if (index >= 0) {
    slots[index] = { ...slots[index], taken: Math.max(slots[index].delivered, slots[index].taken - 1) };
    common.setSlots(player, slots);
  }
  common.putDown(player);
  player.sendMessage(CONFISCATED);
}

function inPort(player) {
  if (common.core().Sailing.instanceAboard(player)) return true;
  const here = player.getLocation();
  // Official dock inzone_land/inzone_sea are server-only cache columns. This is
  // the existing local resolver's 48-tile envelope, not an observed OSRS polygon.
  return here.getZ() === 0 && common.dockAt(here.getX(), here.getY()) !== undefined;
}

function start({ player, crate }) {
  forget({ player });
  if (crate === undefined) return;
  const { Task, TaskManager } = common.core();
  const token = { outside: null, task: null };
  token.task = new (class extends Task {
    // Object key survives ordinary walking/actions; logout explicitly stops it.
    constructor() { super(1, player, false); }
    execute() {
      if (watches.get(player) !== token || common.heldCrate(player) !== crate) {
        this.stop();
        return;
      }
      if (inPort(player)) {
        token.outside = null;
      } else if (token.outside === null) {
        token.outside = 0;
        player.sendMessage(LEAVING);
      } else if (++token.outside >= GRACE_TICKS) {
        confiscate(player);
      }
    }
  })();
  watches.set(player, token);
  TaskManager.submit(token.task);
}

function login({ player }) {
  const crate = common.heldCrate(player);
  const slot = crate === undefined ? -1 : carriedSlot(player, crate);
  player.setAttribute(common.CARRIED_SLOT_ATTRIBUTE, slot);
  player.getPacketSender().sendVarbit(common.VARBIT.CARRYING_CARGO, crate === undefined ? 0 : 1);
  player.getPacketSender().sendVarbit(common.VARBIT.LAST_CARGO_TAKEN, slot + 1);
  start({ player, crate });
}

function landed({ player }) {
  confiscate(player);
}

/** Death has already resolved item loss; retained cargo on a safe death remains carried. */
function died({ player }) {
  if (common.heldCrate(player) !== undefined) return;
  const slot = player.getAttribute(common.CARRIED_SLOT_ATTRIBUTE);
  if (!watches.has(player) && !(Number.isInteger(slot) && slot >= 0)) return;
  common.clearCarrying(player);
}

function canUseHands(event) {
  if (common.heldCrate(event.player) === undefined) return;
  event.allow = false;
  event.player.sendMessage(HANDS_FULL);
}

function canEquip(event) {
  const { Equipment } = common.core();
  if (event.slot === Equipment.WEAPON_SLOT || event.slot === Equipment.SHIELD_SLOT) canUseHands(event);
}

function canUnequip(event) {
  if (!common.isCrate(event.item.getId()) || common.heldCrate(event.player) === undefined) return;
  event.allow = false;
  event.player.sendMessage(CANNOT_REMOVE);
}

// Deposit worn uses the bank policy directly, without the equipment removal hook.
function canBankCargo(event) {
  if (!common.isCrate(event.item.getId())) return;
  event.allow = false;
  if (!event.quiet) event.player.sendMessage(CANNOT_REMOVE);
}

/**
 * Courier crates gone with the boat: their task slots take the crate back (`taken` drops, never
 * below `delivered`), so the source ledger can hand out a replacement. Same accounting as the
 * hand crate's confiscation above.
 */
function writeOffLostCrates(player, crates) {
  if (!player || !Array.isArray(crates) || crates.length === 0) return;
  const slots = common.slots(player);
  let changed = false;
  for (const crate of crates) {
    const index = slots.findIndex((slot) => {
      const task = slot && common.taskById(slot.id);
      return task?.crate === crate.id && slot.taken > slot.delivered;
    });
    if (index < 0) continue;
    const amount = Math.max(1, Math.trunc(Number(crate.amount)) || 1);
    slots[index] = { ...slots[index], taken: Math.max(slots[index].delivered, slots[index].taken - amount) };
    changed = true;
  }
  if (changed) common.setSlots(player, slots);
}

/**
 * The boat went down with cargo aboard. Live loses it at that moment, not at a later recovery
 * (Wiki, Sailing → Death & Capsizing: a death at sea, a capsize or a teleport from the boat
 * loses courier crates, bounty items, salvage and trawling fish, and keeps supplies), so the drop
 * and the task-slot write-off both ride on `Cargo.loseCargo`, the routine every other loss path
 * uses too. Without the write-off a required crate stayed counted as taken and the cargo port
 * refused to hand out another (#6878).
 */
function boatLost({ player, boat }) {
  if (!player || !boat) return;
  Cargo.loseCargo(player, boat);
}

/** Whatever dropped a hold's crates (a sink, capsize, Summon Boat, the cape, a recovery) reports
 *  them as `sailing:cargo-lost`; each one goes back to its task slot. */
function cargoLost({ player, crates }) {
  writeOffLostCrates(player, crates);
}

/** Required task cargo must remain recoverable through the hold and source ledger. */
function canDestroyBoat(event) {
  const required = common.slots(event.player).some(slot => {
    const task = slot && common.taskById(slot.id);
    return task?.cancellable === false && slot.taken > slot.delivered
      && event.owned.cargo.some(item => item?.id === task.crate && item.amount > 0);
  });
  if (!required) return;
  event.allow = false;
  event.player.sendMessage("Return your required port task cargo before destroying this boat.");
}

function attach(api) {
  common.init(api);
  api.persistAttribute(common.CARRIED_SLOT_ATTRIBUTE, -1);
  api.onCustomEvent("port-tasks:cargo-carried", start);
  api.onCustomEvent("port-tasks:cargo-released", forget);
  api.onCustomEvent("sailing:boat-sunk", boatLost);
  api.onCustomEvent("sailing:cargo-lost", cargoLost);
  api.onCustomEvent("teleport:landed", landed);
  api.onCustomEvent("sailing:can-use-hands", canUseHands);
  api.onCustomEvent("sailing:can-destroy-boat", canDestroyBoat);
  api.onCanEquip(canEquip);
  api.onCanUnequip(canUnequip);
  api.onCanBankItem(canBankCargo);
  api.onPlayerLogin(login);
  api.onPlayerLogout(forget);
  api.onPlayerDeath(died);
}

module.exports = attach;
module.exports._test = { canBankCargo };

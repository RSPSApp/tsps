"use strict";

// The Gauntlet stores carried items, including for Ultimate Ironmen (Wiki: The Gauntlet).
// A full stall holds item transfers until each snapshot's save has actually finished writing.
const Shared = require("./Shared.Gauntlet");
const ESCROW_ATTRIBUTE = "gauntlet:equipment-escrow";
const LEGACY_ECHO_ATTRIBUTE = "gauntlet:echo-equipment-escrow";
const pending = new WeakMap();
const locked = new WeakSet();

function snapshot(container) {
  return container.getItems().map(item => item && item.getId() >= 0
    ? { id: item.getId(), amount: item.getAmount(), meta: Shared.core().Item.cloneMeta(item.getMeta?.()) } : null);
}

function decode(rows, count) {
  if (!Array.isArray(rows) || rows.length !== count || rows.some(row => row !== null &&
    (!row || typeof row !== "object" || !Number.isInteger(row.id) || row.id < 0 || !Shared.core().CacheDefinitions.hasItem(row.id)
      || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > 2147483647
      || (row.meta != null && (typeof row.meta !== "object" || Array.isArray(row.meta)))))) return null;
  return rows.map(row => row ? new (Shared.core().Item)(row.id, row.amount, row.meta) : new (Shared.core().Item)(-1, 0));
}

function has(player) {
  return !!(pending.has(player) || player.getAttribute(ESCROW_ATTRIBUTE) || player.getAttribute(LEGACY_ECHO_ATTRIBUTE));
}

function lock(player, held) {
  const movement = player.getMovementQueue();
  movement.reset();
  movement.walkToReset?.();
  movement.setBlockMovement(held);
  if (held) { locked.add(player); player.getCombat().holdFullStall(true); }
  else { locked.delete(player); player.getCombat().releaseFullStall(); }
}

/** save() only queues a snapshot; flush() is the backend's durable-write/error boundary. */
function commit(player, done, failed) {
  try {
    const persistence = Shared.core().GameConstants.PLAYER_PERSISTENCE;
    if (!persistence?.flush) throw new Error("Gauntlet item storage requires durable player persistence");
    persistence.save(player, "gauntlet-equipment");
    const write = persistence.flush();
    if (write?.then) write.then(done).catch(failed);
    else done(); // Synchronous persistence implementations (the in-process fixture).
  } catch (error) { failed(error); }
}

function failed(player, error) {
  console.warn("[gauntlet] equipment save failed", player.getUsername(), error);
  player.sendMessage("Your Gauntlet items could not be saved. They remain protected; please reconnect to recover them.");
}

function begin(run, enter) {
  const { player } = run;
  if (has(player)) throw new Error("Gauntlet equipment is already stored or recovering");
  if ([Shared.core().PlayerStatus.TRADING, Shared.core().PlayerStatus.DUELING].includes(player.getStatus?.())) {
    throw new Error("Finish trading or duelling before entering the Gauntlet");
  }
  player.closeInterruptibleInterfaces?.();
  player.getPacketSender().sendInterfaceRemoval?.();
  // Before replacement, recovery keeps the real containers. An aborted entry must never
  // restore an older snapshot over items changed while its write was pending.
  const escrow = { version: 1, stored: false, inventory: snapshot(player.getInventory()), equipment: snapshot(player.getEquipment()) };
  lock(player, true);
  player.setAttribute(ESCROW_ATTRIBUTE, escrow);
  const state = { entering: true, cancelled: false };
  pending.set(player, state);
  commit(player, () => {
    pending.delete(player);
    // Logout already snapshots this safe escrow. Never write again from a removed old session.
    if (player.isRegistered?.() === false) { run.end("entry-failed", { fade: false, restore: false }); lock(player, false); return; }
    if (state.cancelled || run.stage === "ended") return recover(player);
    enter();
  }, error => {
    pending.delete(player);
    if (player.isRegistered?.() === false) { run.end("entry-failed", { fade: false, restore: false }); lock(player, false); return; }
    run.end("entry-failed", { fade: false });
    failed(player, error);
  });
}

/** Restore by replacement, never addition, so a saved recovery can be retried without duplication. */
function recover(player) {
  const inFlight = pending.get(player);
  if (inFlight) { inFlight.cancelled = true; return true; }
  const key = player.getAttribute(ESCROW_ATTRIBUTE) ? ESCROW_ATTRIBUTE : LEGACY_ECHO_ATTRIBUTE;
  const escrow = player.getAttribute(key);
  if (!escrow) { if (locked.has(player)) lock(player, false); return false; }
  lock(player, true);
  const inventory = decode(escrow.inventory, player.getInventory().getItems().length);
  const equipment = decode(escrow.equipment, player.getEquipment().getItems().length);
  if (escrow.version !== 1 || !inventory || !equipment) {
    player.sendMessage("Your Gauntlet equipment recovery needs assistance. Your saved items have been preserved.");
    return true;
  }
  if (escrow.stored !== false) {
    player.getInventory().setItems(inventory).refreshItems();
    player.getEquipment().setItems(equipment).refreshItems();
    player.resetAttributes(); // Combat interface, bonuses and appearance must use the restored gear.
    lock(player, true); // resetAttributes releases movement; the recovery write is still pending.
  }
  player.setAttribute(key, null);
  player.setAttribute(require("./RunState.Gauntlet").ATTR_RUN, null);
  player.moveTo(Shared.loc(Shared.LOBBY));
  pending.set(player, { entering: false });
  const shape = () => JSON.stringify([snapshot(player.getInventory()), snapshot(player.getEquipment())]);
  let savedShape = shape();
  const finish = () => {
    // Legacy reorder packets may still rearrange slots while transfers are held. Commit the
    // new arrangement before unlocking, but never start another write from a removed session.
    if (player.isRegistered?.() !== false && shape() !== savedShape) {
      savedShape = shape();
      return commit(player, finish, saveFailed);
    }
    pending.delete(player);
    lock(player, false);
  };
  const saveFailed = error => {
    pending.delete(player);
    // The write may have succeeded before another write failed. Keep the idempotent record
    // and the transfer lock either way; a reconnect can safely replace these same slots again.
    player.setAttribute(key, escrow);
    failed(player, error);
  };
  commit(player, finish, saveFailed);
  return true;
}

/** The only point at which originals may be replaced, after the durable save and entry fade. */
function replace(run) {
  const { player } = run, escrow = player.getAttribute(ESCROW_ATTRIBUTE);
  if (JSON.stringify(snapshot(player.getInventory())) !== JSON.stringify(escrow.inventory)
    || JSON.stringify(snapshot(player.getEquipment())) !== JSON.stringify(escrow.equipment)) {
    throw new Error("Carried items changed during Gauntlet entry; please try again");
  }
  escrow.stored = true;
}

/** Called only after the temporary kit and map have been installed successfully. */
function entered(run) {
  const escrow = run.player.getAttribute(ESCROW_ATTRIBUTE);
  const carried = [...escrow.inventory, ...escrow.equipment].filter(Boolean);
  Shared.api().emitCustomEvent("gauntlet:starting-kit", { player: run.player, carried });
  lock(run.player, false);
}

function refuseTransfer(event) {
  if (event.action === "bonus") return; // Equipment-stat reads never move an item.
  if (locked.has(event.player) || locked.has(event.target)) event.allow = false;
}
function blockWidget(event) {
  if (locked.has(event.player)) event.handled = true;
}
function register(api) {
  api.persistAttribute(ESCROW_ATTRIBUTE, null);
  api.persistAttribute(LEGACY_ECHO_ATTRIBUTE, null);
  api.onCanBank(refuseTransfer);
  api.onCanBankItem(refuseTransfer);
  api.onCanShop(refuseTransfer);
  api.onCanTrade(refuseTransfer);
  api.onCanEquip(refuseTransfer);
  api.onCanUnequip(refuseTransfer);
  api.onCanUseItem(refuseTransfer);
  api.onCustomEvent("player:widget-action", blockWidget);
}

function hold(player) { lock(player, true); }

module.exports = { ESCROW_ATTRIBUTE, LEGACY_ECHO_ATTRIBUTE, snapshot, decode, has, begin, replace, recover, entered, hold, register };

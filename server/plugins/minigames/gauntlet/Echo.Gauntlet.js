"use strict";
/**
 * Echo Hunllef placeholder: the existing Corrupted Hunllef controller exactly, with no Echo
 * triple-prayer/lightning mechanics. Wiki Echo entry supplies perfected gear and skips prep.
 * Original items are escrowed in the profile before the temporary kit replaces either container.
 */
const Shared = require("./Shared.Gauntlet");
const Run = require("./RunState.Gauntlet");
const Rewards = require("./Rewards.Gauntlet");
const Items = require("./Items.Gauntlet");
const Map = require("./Map.Gauntlet");
const { HunllefFight } = require("./Hunllef.Gauntlet");
const ESCROW_ATTRIBUTE = "gauntlet:echo-equipment-escrow";
const BOSS = "corrupted-hunllef";

function save(player) {
  const persistence = Shared.core().GameConstants.PLAYER_PERSISTENCE;
  if (persistence) persistence.save(player, "echo-hunllef-equipment");
}
function snapshot(container) {
  return container.getItems().map(item => item && item.getId() >= 0 ? { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null } : null);
}
function decode(rows, count) {
  if (!Array.isArray(rows) || rows.length !== count) return null;
  const { Item } = Shared.core();
  if (rows.some(row => row && (!Number.isInteger(row.id) || row.id < 0 || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > 2147483647))) return null;
  return rows.map(row => row ? new Item(row.id, row.amount, row.meta) : new Item(-1, 0));
}
function recover(player) {
  const escrow = player.getAttribute(ESCROW_ATTRIBUTE);
  if (!escrow) return false;
  const inventory = decode(escrow.inventory, player.getInventory().getItems().length);
  const equipment = decode(escrow.equipment, player.getEquipment().getItems().length);
  if (escrow.version !== 1 || !inventory || !equipment) {
    player.sendMessage("Your Echo Hunllef equipment recovery needs assistance. Your saved items have been preserved.");
    return true;
  }
  player.getInventory().setItems(inventory).refreshItems();
  player.getEquipment().setItems(equipment).refreshItems();
  player.setAttribute(ESCROW_ATTRIBUTE, null);
  player.setAttribute(Run.ATTR_RUN, null);
  player.moveTo(Shared.loc(Shared.LOBBY));
  save(player);
  return true;
}
function giveKit(player) {
  const { Equipment, Item, ItemIdentifiers: I } = Shared.core();
  const kit = Items.MODES.corrupted;
  Shared.clearItems(player);
  const equipment = player.getEquipment(), inventory = player.getInventory();
  equipment.setItem(Equipment.HEAD_SLOT, new Item(kit.helm[2]));
  equipment.setItem(Equipment.BODY_SLOT, new Item(kit.body[2]));
  equipment.setItem(Equipment.LEG_SLOT, new Item(kit.legs[2]));
  for (const id of [kit.halberd[2], kit.bow[2], kit.staff[2], I.CRYSTAL_DAGGER_PERFECTED_, I.EGNIOL_POTION_4_, I.EGNIOL_POTION_4_, ...Array(14).fill(Items.SHARED.paddlefish)]) inventory.adds(id, 1);
  inventory.refreshItems(); equipment.refreshItems();
}
function ready(player) {
  if (Run.runOf(player) || Rewards.waitingReward(player) || player.getAttribute(ESCROW_ATTRIBUTE)) return false;
  const quest = { player, key: "song_of_the_elves", complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", quest);
  if (!quest.complete) { player.sendMessage("You need to complete Song of the Elves to enter the Gauntlet."); return false; }
  if (!player.getAttribute(require("./Lobby.Gauntlet").ATTR_SPOKEN_TO_BRYN)) { player.sendMessage("Speak to Bryn before entering the Gauntlet."); return false; }
  if (player.getAttribute("pets:current")) { player.sendMessage("You cannot take a pet into the Gauntlet."); return false; }
  return true;
}
function start(event) {
  if (event.boss !== BOSS || event.handled) return;
  event.handled = true;
  if (!ready(event.player)) return;
  const claim = { player: event.player, boss: BOSS, token: null };
  Shared.api().emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  try { Run.startRun(event.player, { corrupted: true, echo: { token: claim.token } }); }
  catch (error) {
    const run = Run.runOf(event.player);
    run?.map?.destroy(); if (run) Run.forgetRun(run);
    recover(event.player);
    Shared.api().emitCustomEvent("echo-boss:release", { player: event.player, token: claim.token });
    throw error;
  }
}
function startRun(run) {
  const { player } = run;
  player.setAttribute(ESCROW_ATTRIBUTE, { version: 1, inventory: snapshot(player.getInventory()), equipment: snapshot(player.getEquipment()) });
  // Synchronous save before changing either carried container: a crash can always recover originals.
  save(player);
  player.setAttribute(Run.ATTR_RUN, "echo");
  Shared.fadeMove(player, () => {
    if (run.stage === "ended" || player.isRegistered?.() === false) return;
    try {
    giveKit(player);
    player.resetAttributes();
    run.map.enter(player);
    run.hunllef = new HunllefFight(run);
    player.moveTo(run.map.roomTile(run.map.room(Map.CENTRE, Map.CENTRE), 4, 4));
    run.startCycle = Shared.core().World.getProcessCycle();
    run.sendMazeVarbits();
    player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.TIMER, 1);
    run.startBossPhase();
    save(player);
    } catch (error) {
      endRun(run, "entry-failed");
      throw error;
    }
  });
}
function endRun(run, reason, { fromArea = false } = {}) {
  if (run.stage === "ended") return;
  run.stage = "ended";
  run.timer?.stop(); run.hunllef?.stop();
  const { player } = run;
  if (reason === "completed") {
    let queued = false;
    Shared.api().emitCustomEvent("echo-boss:completed", { player, boss: BOSS, token: run.echo.token,
      npcs: [run.hunllef.npc], queueReward: drops => { Rewards.setReward(player, "corrupted", "completed", drops); queued = true; } });
    if (queued) Run.recordStat(player, "completions", "corrupted");
    // The Wiki counts the completion; the supplied kit cannot satisfy normal preparation/speed CAs.
    if (queued) Shared.api().emitCustomEvent("gauntlet:end", { run, player, reason, reward: "completed" });
  }
  Shared.api().emitCustomEvent("echo-boss:release", { player, token: run.echo.token });
  Run.forgetRun(run);
  if (!fromArea && player.getArea() === run.map) run.map.leave(player, reason === "logout");
  run.map.destroy();
  player.resetAttributes();
  recover(player);
  const sender = player.getPacketSender();
  sender.closeSubInterface(Shared.OVERLAY_HUD_UID);
  sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 0); sender.sendVarbit(Shared.VARBIT.MAZE_MAP, 0);
  Run.sendCompletionVarp(player);
  if (reason === "completed") player.sendMessage("Your reward awaits you in the nearby chest.");
}
function logout({ player }) {
  const run = Run.runOf(player);
  // Includes the two fade ticks before entry, while the player is still in the lobby.
  if (run?.echo) endRun(run, "logout");
}
module.exports = function attach(api) {
  api.persistAttribute(ESCROW_ATTRIBUTE, null);
  api.onCustomEvent("echo-boss:start", start);
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(logout);
};
Object.assign(module.exports, { start, ready, startRun, endRun, recover, giveKit, snapshot, decode, logout, ESCROW_ATTRIBUTE });

"use strict";

// Wiki 2026 Easter event, Rewards: Archibald; two noted Easter eggs with at least 25 hours
// of play time; and every Easter reward from earlier years, reclaimable from Diango.
const Progress = require("./Progress.EasterEvents");
const COMPANION = "easter26_egg_companion";
const RUNAWAY = "easter26_runaway_egg";
const RARE = Object.freeze({ symbol: "cert_easter_egg", amount: 2 });
const RARE_PLAY_SECONDS = 25 * 60 * 60;
// Wiki Event rewards#Easter (2013-2026) intersected with Diango's catalogue (enum708)
// nonnegative slots. The Easter egg itself is a rare award, not a reclaim slot.
const UNLOCKS = Object.freeze([
  "easter07_chicken_head", "easter07_chicken_wings", "easter07_chicken_legs", "easter07_chicken_feet",
  "bunnyears", "easter06_ring_of_egg", "rubber_chicken", "easter_basket_2005", "bunnyfeet",
  "easter16_onsie_top", "easter16_onsie_bottom", "easter16_onsie_gloves", "easter17_head",
  "easter18_eggshell_body", "easter18_eggshell_legs", "easter19_giant_egg", "easter19_bunny_mask",
  "easter20_magic_egg", "easter20_carrot_sword", "easter20_carrot_sword_gold",
  "easter21_eastdoor", "easter21_hat", "easter22_reward_hat", "easter22_reward_crate",
  "easter23_dagger", "easter23_spade", "easter23_nest_hat_egg",
  "easter24_reward_book_easter", "easter24_egg_robe_top", "easter24_egg_robe_bottom", "easter24_egg_mitre", "easter24_egg_necklace",
  "easter25_carrot_hat", "easter25_carrot_torso", "easter25_carrot_hands", "easter25_carrot_legs",
  COMPANION,
]);
const EVENT_TITLE = "The brave chocolate egg";
const scrolls = new WeakSet();

function itemId(api, symbol) {
  const id = api.core.CacheDefinitions.getObjId(symbol);
  if (id === null) throw new Error("Missing 2026 Easter reward " + symbol);
  return id;
}
function eligibleForRares(api, player) {
  const request = { player };
  api.emitCustomEvent("player:lifetime-seconds", request);
  return typeof request.seconds === "number" && Number.isFinite(request.seconds) && request.seconds >= RARE_PLAY_SECONDS;
}
function rewards(api, player) {
  const rows = [{ symbol: COMPANION, id: itemId(api, COMPANION), amount: 1 }];
  if (eligibleForRares(api, player)) rows.push({ ...RARE, id: itemId(api, RARE.symbol) });
  return rows;
}
/** Plans the grant on a copy of the inventory: the rewards, then handing over the runaway egg. */
function plan(api, player) {
  const state = Progress.read(player), inventory = player.getInventory(), runaway = itemId(api, RUNAWAY);
  if (!state.caught || state.complete || inventory.getAmount(runaway) < 1) return null;
  const copy = new api.core.Inventory(player).setItems(inventory.getCopiedItems());
  const rows = rewards(api, player);
  let missing = 0;
  for (const row of rows) {
    const reward = new api.core.Item(row.id, row.amount);
    if (copy.getAddableAmount(reward) !== row.amount) { missing++; continue; }
    copy.add(reward, false);
  }
  if (missing) return { missing, rows };
  copy.deleteAtSlot(copy.getSlotForItemId(runaway), 1, false);
  return { missing: 0, rows, items: copy.getItems() };
}
function missingSlots(api, player) {
  return plan(api, player)?.missing ?? 0;
}
function claim(api, player) {
  const next = plan(api, player);
  if (!next || next.missing) return false;
  // HolidayRewards validates the whole catalogue request before saving any entitlement.
  const unlock = { player, items: [...UNLOCKS] };
  api.emitCustomEvent("holiday-rewards:unlock", unlock);
  if (unlock.accepted !== true) return false;
  player.getInventory().setItems(next.items);
  player.getInventory().refreshItems();
  const state = Progress.read(player);
  state.complete = true;
  Progress.write(api, player, state);
  return next.rows;
}
function show(api, player, rows) {
  const cache = api.core.CacheDefinitions, sender = player.getPacketSender();
  sender.sendInterface(cache.getInterfaceId("eventscroll"));
  sender.sendString(EVENT_TITLE, cache.getComponentId("eventscroll:event_title"));
  const names = rows.map(row => row.symbol === COMPANION ? "Archibald" : `${row.amount} x Easter egg`);
  sender.sendString(names.map(name => "- " + name).join("<br>"), cache.getComponentId("eventscroll:event_rewards"));
  sender.sendInterfaceModel(cache.getComponentId("eventscroll:event_model"), itemId(api, COMPANION), 10);
  sender.sendInterfaceModel(cache.getComponentId("eventscroll:event_type_model"), itemId(api, "easter_egg"), 10);
  scrolls.add(player);
}
function showNextTick(api, player, rows) {
  const c = api.core;
  class EasterCompletionScroll extends c.Task {
    constructor() { super(1, player, false); }
    execute() { this.stop(); if (player.isRegistered()) show(api, player, rows); }
  }
  c.TaskManager.submit(new EasterCompletionScroll());
}
function closeScroll(api, event) {
  const { player } = event, cache = api.core.CacheDefinitions;
  if (!scrolls.has(player) || player.getInterfaceId() !== cache.getInterfaceId("eventscroll") ||
    event.buttonId !== cache.getComponentId("eventscroll:close_button")) return;
  event.handled = true;
  if ((event.opId ?? event.action) !== 1) return;
  scrolls.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
}
function clear({ player }) { scrolls.delete(player); }

module.exports = { UNLOCKS, RARE_PLAY_SECONDS, plan, missingSlots, claim, show, showNextTick, closeScroll, clear };

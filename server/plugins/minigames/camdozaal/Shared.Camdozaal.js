"use strict";

const Runtime = require("../../quests/QuestRuntime");
let api;
const STORED_ATTRIBUTE = "camdozaal:stored-shards";
const BUFFS_ATTRIBUTE = "camdozaal:buffs";
const BOOST_ATTRIBUTE = "camdozaal:boost-expires-at";
const RAMARNO_INTRO_ATTRIBUTE = "quest.below_ice_mountain.met-ramarno";
const MAX_SHARDS = 0x7fffffff;
const SHOP = 685;
const STORED_VARP = 2953;
const BUFF_VARBITS = [12099, 12100, 12101, 12102, 12103];
const BOOST_REMAINING_VARBIT = 12106;
const BUFFS = [
  { name: "Fishing", component: 3, cost: 2500 },
  { name: "Preparation", component: 4, cost: 2500 },
  { name: "Defence", component: 6, cost: 2500 },
  { name: "Mining", component: 8, cost: 2500 },
  { name: "Luck", component: 10, cost: 3000 },
  { name: "Boost", component: 12, cost: 1000 },
];

function bind(value) { api = value; }
function core() { return api.core; }
function pluginApi() { return api; }
function obj(name) {
  const id = core().CacheDefinitions.getObjId(name);
  if (!Number.isInteger(id)) throw new Error(`Camdozaal: missing item gameval ${name}`);
  return id;
}
function stored(player) { return Math.max(0, Math.min(MAX_SHARDS, Number(player.getAttribute(STORED_ATTRIBUTE)) || 0)); }
function flags(player) { return Number(player.getAttribute(BUFFS_ATTRIBUTE)) || 0; }
function purchased(player, index) { return (flags(player) & (1 << index)) !== 0; }
function boostTicks(player) { return Math.max(0, Math.ceil(((Number(player.getAttribute(BOOST_ATTRIBUTE)) || 0) - Date.now()) / 600)); }
function inRuins(player) {
  const p = player.getLocation();
  return p.getZ() === 0 && p.getX() >= 2897 && p.getX() <= 3047 && p.getY() >= 5757 && p.getY() <= 5869;
}
function questComplete(player) {
  const quest = Runtime.getRegisteredQuests().find(q => q.key === "below_ice_mountain");
  return !!quest?.isComplete(player);
}
function unlocked(player) { return questComplete(player) && Number(player.getAttribute(RAMARNO_INTRO_ATTRIBUTE)) >= 2; }
function gate(player) {
  if (unlocked(player)) return true;
  player.sendMessage("You should speak to Ramarno first.");
  return false;
}
function sync(player) {
  const sender = player.getPacketSender();
  sender.sendConfig(STORED_VARP, stored(player));
  BUFF_VARBITS.forEach((id, index) => sender.sendVarbit(id, purchased(player, index) ? 1 : 0));
  sender.sendVarbit(BOOST_REMAINING_VARBIT, Math.min(60, Math.ceil(boostTicks(player) / 100)));
}
function setStored(player, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SHARDS) throw new Error("Invalid Camdozaal shard balance");
  player.setAttribute(STORED_ATTRIBUTE, value);
  player.getPacketSender().sendConfig(STORED_VARP, value);
}
function save(player) { api.emitCustomEvent("persistence:save", { player, reason: "camdozaal" }); }
function shards(player) { return player.getInventory().getAmount(obj("camdozaal_barronite_shard")); }

function format(amount) { return Number(amount).toLocaleString("en-US"); }
/** The chatbox amount prompt; a zero or empty answer still calls back, with 0. */
function askAmount(player, prompt, then) {
  player.setEnteredAmountAction({ acceptsZero: true, execute: count => then(Math.max(0, Math.floor(Number(count) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt(prompt);
}
/** Moves up to `count` carried shards into the forge; returns how many moved. */
function store(player, count) {
  const amount = Math.min(Math.max(0, Math.floor(Number(count) || 0)), shards(player), MAX_SHARDS - stored(player));
  if (amount <= 0) return 0;
  player.getInventory().deleteNumber(obj("camdozaal_barronite_shard"), amount);
  setStored(player, stored(player) + amount);
  save(player);
  return amount;
}
/** Moves up to `count` stored shards into the inventory; returns how many moved. */
function withdraw(player, count) {
  const inventory = player.getInventory();
  const id = obj("camdozaal_barronite_shard");
  const amount = Math.min(Math.max(0, Math.floor(Number(count) || 0)), stored(player), MAX_SHARDS - shards(player));
  if (amount <= 0) return 0;
  if (inventory.getFreeSlots() === 0 && !inventory.contains(id)) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.adds(id, amount);
  setStored(player, stored(player) - amount);
  save(player);
  return amount;
}

/** Exchange accepts carried and stored shards; vault admission uses stored shards alone. */
function pay(player, amount, storedOnly = false) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return false;
  const carried = storedOnly ? 0 : shards(player);
  if (stored(player) + carried < amount) return false;
  const take = Math.min(amount, carried);
  if (take) player.getInventory().deleteNumber(obj("camdozaal_barronite_shard"), take);
  setStored(player, stored(player) - (amount - take));
  return true;
}

module.exports = { bind, core, pluginApi, obj, STORED_ATTRIBUTE, BUFFS_ATTRIBUTE, BOOST_ATTRIBUTE,
  MAX_SHARDS, SHOP, BUFFS, stored, flags, purchased, boostTicks, inRuins, questComplete, unlocked, gate, sync, setStored, save, shards, pay,
  format, askAmount, store, withdraw };

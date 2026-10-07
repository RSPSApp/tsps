"use strict";

/**
 * ::maxgear <melee|range|mage> [void] - a developer's best-in-slot gear for testing bosses.
 * Worn gear goes to the bank; the inventory and stats are left alone (::master gives 99s).
 * `void` swaps in that style's void helm and elite void. The sets are data:
 * data/definitions/dev-loadouts.json.
 */

const fs = require("fs");
const path = require("path");
const { Autocasting } = require("../../src/main/typescript/elvarg/game/content/combat/magic/Autocasting");

const STYLES = { melee: "melee", range: "range", ranged: "range", mage: "mage", magic: "mage" };
const SLOTS = {
  head: "HEAD_SLOT", cape: "CAPE_SLOT", amulet: "AMULET_SLOT", weapon: "WEAPON_SLOT", body: "BODY_SLOT",
  shield: "SHIELD_SLOT", legs: "LEG_SLOT", hands: "HANDS_SLOT", feet: "FEET_SLOT", ring: "RING_SLOT",
  ammo: "AMMUNITION_SLOT",
};
const USAGE = "Use ::maxgear <melee|range|mage> [void].";

let pluginApi = null;
let loadouts = null;

function core() {
  return pluginApi.core;
}

/** The sets, read on first use. */
function data() {
  if (loadouts) return loadouts;
  const file = path.join(core().GameConstants.DEFINITIONS_DIRECTORY, "dev-loadouts.json");
  loadouts = JSON.parse(fs.readFileSync(file, "utf8"));
  return loadouts;
}

/** "NAME", ["NAME", amount] or { item, amount, meta } -> { id, amount, meta }. */
function readEntry(entry, where) {
  const spec = typeof entry === "string" ? { item: entry }
    : Array.isArray(entry) ? { item: entry[0], amount: entry[1] }
      : entry;
  const id = core().ItemIdentifiers[spec?.item];
  if (!Number.isInteger(id)) throw new Error(`[maxgear] ${where}: unknown item ${spec?.item}`);
  return { id, amount: spec.amount ?? 1, meta: spec.meta ?? null };
}

/** The style's set, with the void pieces over it when asked. */
function loadoutFor(style, withVoid) {
  const set = { ...data().styles[style], ...(withVoid ? data().void[style] : {}) };
  return Object.entries(set).map(([slot, entry]) => {
    const name = SLOTS[slot];
    if (!name) throw new Error(`[maxgear] ${style}: unknown slot ${slot}`);
    return { slot: core().Equipment[name], ...readEntry(entry, `${style}.${slot}`) };
  });
}

function makeItem({ id, amount, meta }) {
  const item = new (core().Item)(id, amount);
  for (const [key, value] of Object.entries(meta ?? {})) item.setMetaValue(key, value);
  return item;
}

/** Puts on a set: what was worn goes to the bank. Returns the equipped item ids. */
function equip(player, style, withVoid) {
  const { Bank, Flag, WeaponInterfaceManager } = core();
  const equipment = player.getEquipment();
  for (const item of equipment.getCopiedItems()) {
    if (item && item.getId() > 0 && item.getAmount() > 0) {
      player.getBank(Bank.getTabForItem(player, item.getId())).add(item, false);
    }
  }
  equipment.resetItems();
  const set = loadoutFor(style, withVoid);
  for (const entry of set) equipment.setItem(entry.slot, makeItem(entry));
  player.setSpecialActivated?.(false);
  player.getPacketSender().sendSpecialAttackState?.(false);
  // A powered staff casts its own spell; nothing else should be autocast.
  Autocasting.setAutocast(player, null);
  WeaponInterfaceManager.assign(player);
  pluginApi.getBonusManager().update(player);
  equipment.refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return set.map((entry) => entry.id);
}

function belowMax(player) {
  const { Skill } = core();
  const skills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.PRAYER, Skill.HITPOINTS];
  return skills.some((skill) => player.getSkillManager().getMaxLevel(skill) < 99);
}

function maxGear({ player, parts }) {
  const style = STYLES[String(parts?.[1] ?? "").toLowerCase()];
  const flag = String(parts?.[2] ?? "").toLowerCase();
  if (!style || (flag && flag !== "void")) {
    player.sendMessage(USAGE);
    return true;
  }
  const withVoid = flag === "void";
  equip(player, style, withVoid);
  player.sendMessage(`You put on max ${style} gear${withVoid ? " with elite void" : ""}. Your worn items went to your bank.`);
  if (belowMax(player)) player.sendMessage("Some combat levels are below 99: ::master sets them all.");
  return true;
}

module.exports = {
  name: "MaxGear",
  register(api) {
    pluginApi = api;
    api.registerCommand("maxgear", maxGear, api.core.PlayerRights.DEVELOPER, "Wear best-in-slot gear (worn items go to the bank)");
  },
  maxGear,
  loadoutFor,
};

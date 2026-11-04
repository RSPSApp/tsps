"use strict";

// The easy Wilderness Diary (OSRS Wiki: Wilderness Diary; the journal text is the rule). The tasks
// that belong to another plugin's mechanic are counted there: the levers (Levers.plugin.js), the Chaos
// altar's prayer (Altars.plugin.js), the Chaos temple and the Mage of Zamorak's Abyss (Runecrafting),
// and the Earth warrior (Diary.EdgevilleDungeon.js).
const DIARY = "wilderness";
// Kills by NPC name; `wild` kills count only on a Wilderness tile. The Wiki sets no location for the Chaos
// Elemental or the Lava dragon ("just killing" it, which lives on Lava Dragon Isle). Exact names leave out
// the baby and brutal green dragons and the Dark Ankou, which the Wiki doesn't list.
const KILLS = [
  { name: "Mammoth", task: "kill-a-mammoth-in-the-wilderness", wild: true },
  { name: "Green dragon", task: "kill-a-green-dragon", wild: true },
  { name: "Ankou", task: "kill-an-ankou-in-the-wilderness", wild: true },
  { name: "Chaos Elemental", task: "kill-the-chaos-elemental" },
  { name: "Lava dragon", task: "kill-a-lava-dragon" },
];
const IRON = { task: "mine-some-iron-ore-in-the-wilderness" };
const MITHRIL = { task: "mine-some-mithril-ore-in-the-wilderness" };
const LAVA_EEL = { task: "fish-some-raw-lava-eel-in-the-wilderness" };
const BLACK_SALAMANDER = { task: "catch-a-black-salamander-in-the-wilderness" };
const GHORROCK = { task: "teleport-to-ghorrock", spell: "ghorrock teleport" };
const EGGS = { task: "collect-5-red-spiders-eggs-from-the-wilderness", count: 5, attribute: "wilderness-diary:red-spiders-eggs" };
const TEAM_CAPE = { task: "equip-any-team-cape-in-the-wilderness" };

let api;
let teamCapes;
// The cape each player last wore: "Entering the Wilderness with one already equipped does not count."
const wornCape = new WeakMap();

const done = (player, { task }) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
const inWilderness = (x, y) => api.core.Wilderness.levelAt(x, y) > 0;

/** "Kill a Mammoth in the Wilderness." Mammoths live south-east of Ferox Enclave. */
function npcKilled({ killer, npc }) {
  if (!killer?.isPlayer?.()) return;
  const kill = KILLS.find(({ name }) => name === npc?.getDefinition?.()?.getName?.());
  if (!kill) return;
  const at = npc.getLocation();
  if (!kill.wild || inWilderness(at.getX(), at.getY())) done(killer, kill);
}

const playerInWilderness = (player) => {
  const at = player.getLocation();
  return inWilderness(at.getX(), at.getY());
};

/** "Mine some Iron ore in the Wilderness." and the mithril task. */
function oreMined({ player, itemId }) {
  const ids = api.core.ItemIdentifiers;
  const task = itemId === ids.IRON_ORE ? IRON : itemId === ids.MITHRIL_ORE ? MITHRIL : null;
  if (task && playerInWilderness(player)) done(player, task);
}

/** "Fish some Raw Lava Eel in the Wilderness." */
function fished({ player, itemId }) {
  if (itemId === api.core.ItemIdentifiers.RAW_LAVA_EEL && playerInWilderness(player)) done(player, LAVA_EEL);
}

/** "Catch a Black Salamander in the Wilderness." */
function caught({ player, npcId }) {
  if (npcId === api.core.NpcIdentifiers.BLACK_SALAMANDER && playerInWilderness(player)) done(player, BLACK_SALAMANDER);
}

/** "Teleport to Ghorrock." Credited on arrival. */
function teleported({ player, name }) {
  if (name === GHORROCK.spell) done(player, GHORROCK);
}

/**
 * "Collect 5 Red spiders' eggs from the Wilderness." The eggs lie in the northern Edgeville Dungeon;
 * ones brought in count when dropped and picked up again (Wiki), so every pickup there counts.
 */
function itemTaken({ player, itemId, amount, groundItem }) {
  if (itemId !== api.core.ItemIdentifiers.RED_SPIDERS_EGGS) return;
  const at = groundItem.getPosition();
  if (!inWilderness(at.getX(), at.getY())) return;
  const total = (Number(player.getAttribute(EGGS.attribute)) || 0) + amount;
  player.setAttribute(EGGS.attribute, Math.min(total, EGGS.count));
  if (total >= EGGS.count) done(player, EGGS);
}

function capeOf(player) {
  return player.getEquipment().getItems()[api.core.Equipment.CAPE_SLOT]?.getId() ?? -1;
}

function capeSeen({ player }) {
  wornCape.set(player, capeOf(player));
}

/** "Equip any team cape in the Wilderness." */
function equipmentChanged({ player }) {
  const cape = capeOf(player);
  const before = wornCape.get(player);
  wornCape.set(player, cape);
  if (before === undefined || before === cape || !teamCapes.has(cape)) return;
  const at = player.getLocation();
  if (inWilderness(at.getX(), at.getY())) done(player, TEAM_CAPE);
}

module.exports = function attachWildernessDiary(pluginApi) {
  api = pluginApi;
  const ids = api.core.ItemIdentifiers;
  teamCapes = new Set(Object.keys(ids).filter((key) => /^TEAM_(?:\d+_CAPE|CAPE_(?:I|X|ZERO))(?:_\d+)?$/.test(key)).map((key) => ids[key]));
  api.persistAttribute(EGGS.attribute, 0);
  api.onNpcDeath(npcKilled);
  api.onCustomEvent("mining:success", oreMined);
  api.onCustomEvent("fishing:success", fished);
  api.onCustomEvent("hunter:success", caught);
  api.onCustomEvent("spell:teleport-arrival", teleported);
  api.onCustomEvent("ground-items:taken", itemTaken);
  api.onCustomEvent("equipment:changed", equipmentChanged);
  api.onPlayerLogin(capeSeen);
};
Object.assign(module.exports, { npcKilled });

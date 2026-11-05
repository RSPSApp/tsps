/**
 * Equipment that needs a quest finished before it can be worn or wielded: rune platebody
 * (Dragon Slayer I), dragon scimitar (Monkey Madness I), dragon longsword (Lost City) and the
 * rest in ./data/quest-equipment.json, from the OSRS Wiki.
 *
 * The refusal is live OSRS's two lines (rsprox captures 3276 and 1768): "You have not earned
 * the right to wear this yet." ("wield" for an item whose option is Wield), then "You need to
 * complete the <quest> quest first."
 *
 * world.json pluginConfig `"quests:equipment-requirements": false` disables the check;
 * it defaults to true when the Quests plugin is active, independently of PvP mode.
 *
 * Not gated:
 *  - player bots, which gear up from loadouts rather than quests;
 *  - disabled or missing quests, so the item never becomes unwearable.
 */
const DATA = require("./data/quest-equipment.json");
const EQUIPMENT_REQUIREMENTS_CONFIG = "quests:equipment-requirements";

let pluginApi;
/** Item id -> { quest, message } once built from the data file. */
let requirementByItem = null;

function requirements() {
  if (requirementByItem) return requirementByItem;
  const { ItemIdentifiers } = pluginApi.core;
  requirementByItem = new Map();
  for (const entry of DATA.quests) {
    for (const name of entry.items) {
      const id = ItemIdentifiers[name];
      if (typeof id !== "number") throw new Error(`quest-equipment.json: unknown item ${name}`);
      requirementByItem.set(id, entry);
    }
  }
  return requirementByItem;
}

/** True when the quest is done, or when this server has no such quest to do. */
function questComplete(player, quest) {
  const request = { player, name: quest, complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete !== false;
}

function verbFor(itemId) {
  const actions = pluginApi.core.CacheDefinitions.getItem(itemId)?.inventoryActions ?? [];
  return actions.includes("Wield") ? "wield" : "wear";
}

function refusalMessages(itemId, entry) {
  return entry.message ? [entry.message] : [
    `You have not earned the right to ${verbFor(itemId)} this yet.`,
    `You need to complete the ${entry.quest} quest first.`,
  ];
}

/** quest:can-equip { player, item, allow, messages }: eligibility only, without equip actions. */
function checkEquipment(event) {
  if (pluginApi.getPluginConfig(EQUIPMENT_REQUIREMENTS_CONFIG, true) === false) return;
  const { player, item } = event;
  const itemId = item?.getId?.();
  const entry = requirements().get(itemId);
  if (!entry || player.isPlayerBot?.()) return;
  if (questComplete(player, entry.quest)) return;
  event.allow = false;
  event.messages = refusalMessages(itemId, entry);
}

function canEquip(event) {
  const request = { player: event.player, item: event.item, allow: true, messages: [] };
  checkEquipment(request);
  if (request.allow) return;
  event.allow = false;
  for (const message of request.messages) event.player.sendMessage(message);
}

module.exports = function attachEquipment(api) {
  pluginApi = api;
  api.onCanEquip(canEquip);
  api.onCustomEvent("quest:can-equip", checkEquipment);
};

module.exports._test = { canEquip, requirements };

/**
 * All Settings > Warnings and Notifications rows that compare an item's worth (ValueWarning.js)
 * against the player's threshold:
 *
 * - Drop item warning (42, threshold 43): an item worth at least the threshold asks before it lands
 *   on the floor, as live does: "The item you are trying to put down is considered valuable...",
 *   then "<name>: Really put it down?" with "Put it down." / "No, don't put it down."
 * - Alchemy (66 threshold, 65 untradeables): a valuable item asks "That item is considered
 *   valuable." before the cast; with 65 off an untradeable item no longer asks.
 * - Loot drop notifications (38, threshold 39, untradeables 40): each stack an NPC drops for the
 *   player that is worth at least the threshold, "Valuable drop: 3 x Spider cave teleport (108,567
 *   coins)", and each untradeable one, "Untradeable drop: Brimstone key", in red.
 *
 * The number rows 39, 43, 249 and 449 ask for their value here (the Alchemy row 66 has its own
 * plugin). Ours: the prompts' wording, from the Alchemy row's "Set value threshold for alchemy
 * warnings:".
 *
 *   hear "item:drop-warning" { player, item, itemId, slot, warned, proceed }
 *   hear "magic:alchemy-warning" { player, item, itemId, spellId, high, text }
 *   hear "npc-drops:roll" { player, npc, drops }
 */
const Value = require("./ValueWarning");

const LOOT_ON = 5399;
const LOOT_VALUE = 5400;
const LOOT_UNTRADEABLES = 5402;
const DROP_WARNING_ON = 5411;
const DROP_WARNING_VALUE = 5412;
/** This warning's name in "item:drop-warning"'s `answered`. */
const DROP_WARNING = "value";
const ALCHEMY_VALUE = 6091;
const ALCHEMY_UNTRADEABLES = 6092;

const UNTRADEABLE_LOOT_SETTING = 40;
/** The cache row's own line for a click while loot drop notifications are off. */
const UNTRADEABLE_LOOT_LOCKED = "You must have loot drop notifications turned on to change this setting.";

/** Number rows: the prompt and the largest value the row's var holds. */
const PROMPTS = {
  39: { prompt: "Set value threshold for loot notifications:", max: 500000000 },
  43: { prompt: "Set value threshold for drop item warnings:", max: 500000000 },
  249: { prompt: "Set the number of cannonballs for the low ammo notification:", max: 63 },
  449: { prompt: "Set value threshold for birdhouse seed warnings:", max: 2147483647 },
};

const LOOT_COLOUR = "ef1020";
const VALUABLE = "<col=7f0000>valuable</col>";

let pluginApi = null;

function varbit(player, id) {
  return Number(player.getPacketSender().getVarbit(id)) || 0;
}

function settingClicked(request) {
  const { player, settingId } = request;
  if (settingId === UNTRADEABLE_LOOT_SETTING && varbit(player, LOOT_ON) === 0) {
    request.handled = true;
    player.sendMessage(UNTRADEABLE_LOOT_LOCKED);
    return;
  }
  const row = PROMPTS[settingId];
  if (!row) return;
  request.handled = true;
  Value.promptSetting(pluginApi, player, settingId, row.prompt, row.max);
}

function dropWarning(request) {
  const { player, item } = request;
  if (request.warned || request.answered?.includes(DROP_WARNING) || varbit(player, DROP_WARNING_ON) === 0) return;
  const value = Value.itemValue(pluginApi.core, item.getId(), item.getAmount());
  if (!Value.reaches(value, varbit(player, DROP_WARNING_VALUE))) return;
  request.warned = true;
  Value.confirm(pluginApi.core, player, {
    itemId: item.getId(),
    text: `The item you are trying to put down is considered<br>${VALUABLE}. Are you absolutely sure you want to do that?`,
    title: `${item.getDefinition().getName()}: Really put it down?`,
    yes: "Put it down.",
    no: "No, don't put it down.",
    proceed: () => request.proceed(DROP_WARNING),
  });
}

function alchemyWarning(request) {
  const { player, itemId } = request;
  if (!Value.tradeable(pluginApi.core, itemId)) {
    if (varbit(player, ALCHEMY_UNTRADEABLES) === 0) request.text = null;
    return;
  }
  if (Value.reaches(Value.itemValue(pluginApi.core, itemId), varbit(player, ALCHEMY_VALUE))) {
    request.text = `That item is considered ${VALUABLE}.`;
  }
}

function lootLine(core, drop, threshold, untradeables) {
  const itemId = Number(drop?.itemId ?? drop?.id);
  const amount = Math.trunc(Number(drop?.amount ?? 1));
  if (!(itemId > 0) || !(amount > 0)) return null;
  const name = core.ItemDefinition.forId(itemId)?.getName?.();
  if (!name) return null;
  const counted = amount > 1 ? `${amount.toLocaleString("en-GB")} x ${name}` : name;
  if (!Value.tradeable(core, itemId)) return untradeables ? `<col=${LOOT_COLOUR}>Untradeable drop: ${counted}</col>` : null;
  const value = Value.itemValue(core, itemId, amount);
  return Value.reaches(value, threshold) ? `<col=${LOOT_COLOUR}>Valuable drop: ${counted} (${value.toLocaleString("en-GB")} coins)</col>` : null;
}

/** An NPC's drop, read once the roll's other handlers have edited it (as the collection log does). */
function lootNotifications(request) {
  const { player, npc } = request ?? {};
  if (!player || !npc) return;
  queueMicrotask(() => {
    if (varbit(player, LOOT_ON) === 0) return;
    const threshold = varbit(player, LOOT_VALUE);
    const untradeables = varbit(player, LOOT_UNTRADEABLES) === 1;
    for (const drop of request.drops ?? []) {
      const line = lootLine(pluginApi.core, drop, threshold, untradeables);
      if (line) player.sendMessage(line);
    }
  });
}

module.exports = {
  name: "ValueWarnings",
  description: "All Settings value warnings (drop, Alchemy) and loot drop notifications, and their thresholds.",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("settings:setting-clicked", settingClicked);
    api.onCustomEvent("item:drop-warning", dropWarning);
    api.onCustomEvent("magic:alchemy-warning", alchemyWarning);
    api.onCustomEvent("npc-drops:roll", lootNotifications);
  },
  _test: { settingClicked, dropWarning, alchemyWarning, lootLine, lootNotifications, PROMPTS, setApi: (api) => { pluginApi = api; } },
};

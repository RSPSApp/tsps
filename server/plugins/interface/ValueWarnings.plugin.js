/**
 * All Settings > Warnings and Notifications rows that compare an item's worth (ValueWarning.js)
 * against the player's threshold:
 *
 * - Drop item warning (42, threshold 43): an item worth at least the threshold asks before it lands
 *   on the floor, as live does: "The item you are trying to put down is considered valuable...",
 *   then "<name>: Really put it down?" with "Put it down." / "No, don't put it down."
 *
 * The number rows 39, 43, 249 and 449 ask for their value here (the Alchemy row 66 has its own
 * plugin). Ours: the prompts' wording, from the Alchemy row's "Set value threshold for alchemy
 * warnings:".
 *
 *   hear "item:drop-warning" { player, item, itemId, slot, warned, proceed }
 */
const Value = require("./ValueWarning");

const DROP_WARNING_ON = 5411;
const DROP_WARNING_VALUE = 5412;

/** Number rows: the prompt and the largest value the row's var holds. */
const PROMPTS = {
  39: { prompt: "Set value threshold for loot notifications:", max: 500000000 },
  43: { prompt: "Set value threshold for drop item warnings:", max: 500000000 },
  249: { prompt: "Set the number of cannonballs for the low ammo notification:", max: 63 },
  449: { prompt: "Set value threshold for birdhouse seed warnings:", max: 2147483647 },
};

const VALUABLE = "<col=7f0000>valuable</col>";

let pluginApi = null;

function varbit(player, id) {
  return Number(player.getPacketSender().getVarbit(id)) || 0;
}

function settingClicked(request) {
  const { player, settingId } = request;
  const row = PROMPTS[settingId];
  if (!row) return;
  request.handled = true;
  Value.promptSetting(pluginApi, player, settingId, row.prompt, row.max);
}

function dropWarning(request) {
  const { player, item } = request;
  if (request.warned || varbit(player, DROP_WARNING_ON) === 0) return;
  const value = Value.itemValue(pluginApi.core, item.getId(), item.getAmount());
  if (!Value.reaches(value, varbit(player, DROP_WARNING_VALUE))) return;
  request.warned = true;
  Value.confirm(pluginApi.core, player, {
    itemId: item.getId(),
    text: `The item you are trying to put down is considered<br>${VALUABLE}. Are you absolutely sure you want to do that?`,
    title: `${item.getDefinition().getName()}: Really put it down?`,
    yes: "Put it down.",
    no: "No, don't put it down.",
    proceed: request.proceed,
  });
}

module.exports = {
  name: "ValueWarnings",
  description: "All Settings value warnings and their thresholds.",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("settings:setting-clicked", settingClicked);
    api.onCustomEvent("item:drop-warning", dropWarning);
  },
  _test: { settingClicked, dropWarning, PROMPTS, setApi: (api) => { pluginApi = api; } },
};

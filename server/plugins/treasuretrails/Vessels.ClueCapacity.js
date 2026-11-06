// Arthur's transcript provides the existing confirmation wording and condition IDs.
const DISABLED_ATTRIBUTE = "treasure-trails:vessel-drops-disabled";
const ON_CONDITION = "4LpQvD";
const OFF_CONDITION = "6VYtZ4";
const STOP_CHOICE = "Yes please, I want to stop receiving vesseled containers.";
const START_CHOICE = "Yes please, I want to start receiving vesseled containers";
const pending = new WeakMap();
let api, core;

function disabled(player) {
  return player.getAttribute(DISABLED_ATTRIBUTE) === true;
}

function answerCondition({ player, npcId, stepId }) {
  if (!player || npcId !== core.NpcIdentifiers.ARTHUR_THE_CLUE_HUNTER) return null;
  if (stepId === ON_CONDITION) return !disabled(player);
  if (stepId === OFF_CONDITION) return disabled(player);
  return null;
}

function conditionChosen({ player, npcId, stepId }) {
  if (!player || npcId !== core.NpcIdentifiers.ARTHUR_THE_CLUE_HUNTER) return;
  if (stepId === ON_CONDITION || stepId === OFF_CONDITION) pending.set(player, stepId);
  else pending.delete(player);
}

function confirmChoice({ player, npcId, option }) {
  if (!player || npcId !== core.NpcIdentifiers.ARTHUR_THE_CLUE_HUNTER) return;
  const condition = pending.get(player);
  pending.delete(player);
  if (condition === ON_CONDITION && option === STOP_CHOICE && !disabled(player)) {
    player.setAttribute(DISABLED_ATTRIBUTE, true);
  } else if (condition === OFF_CONDITION && option === START_CHOICE && disabled(player)) {
    player.setAttribute(DISABLED_ATTRIBUTE, false);
  }
}

function clearPending({ player }) {
  if (player) pending.delete(player);
}

function clearOnStart({ player, npcId }) {
  if (player && npcId === core.NpcIdentifiers.ARTHUR_THE_CLUE_HUNTER) pending.delete(player);
}

function vesselChance(request) {
  if (request?.player && disabled(request.player)) request.allowed = false;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  // Existing TSPS vessel producers are enabled for accounts without an opt-out.
  api.persistAttribute(DISABLED_ATTRIBUTE, false);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", conditionChosen);
  api.onCustomEvent("npc-dialogue:choice", confirmChoice);
  api.onCustomEvent("npc-dialogue:start", clearOnStart);
  api.onCustomEvent("treasure-trails:vessel-chance", vesselChance);
  api.onPlayerLogout(clearPending);
}

module.exports = { attach };

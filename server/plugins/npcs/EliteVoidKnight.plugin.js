/**
 * The Elite Void Knight (NPC 5513, the Void Knights' Outpost) upgrades a Void knight top or robe to the
 * elite one for 200 Commendation points (https://oldschool.runescape.wiki/w/Elite_Void_Knight_equipment),
 * once the Hard Western Provinces diary is done. Her talk-to conversation and the lines for each kind
 * of item used on her are the transcript in npc-dialogues.json; this plugin answers its conditions and
 * performs the upgrade at its "The Elite Void Knight upgrades your armour." step.
 *
 * Captured (rsprox 4016, rev 237.1): the menu and lines, an elite top used on her ("I'm afraid that
 * cannot be upgraded."), another item ("No thank you."). NOT captured: a successful upgrade, the diary
 * refusal, and too few points. So the confirmation, the points sum, the diary check and the success line
 * are the transcript's and the Wiki's; the result keeps the used item's slot (the item is changed in
 * place); and the shortfall message reuses the Void Knights' reward interface's own wording. The void
 * orb for Guthixian paint swap (a separate part of the transcript) is not implemented.
 *
 * The item upgraded is the one that was used: it is refused when it is a preset, untradeable or
 * unbankable copy, checked again when the player confirms (it must still be that item in that slot, and
 * the points still there), and nothing is taken until then. Nothing is refunded: there is no way back.
 * A successful upgrade is recorded in the collection log (collection-log:obtain); only a successful one.
 */
const PestRewards = require("../minigames/pestcontrol/Rewards.PestControl");

const COST = 200;
const DIARY = "western";
const TIER = "hard";
const CONDITION_BEFORE = "Before finishing the Hard Western Provinces Diary:";
const CONDITION_AFTER = "After finishing the Hard Western Provinces Diary:";
const CONDITION_AFTER_PAINT = "After finishing the Hard Western Provinces Diary and exchanging void orb for guthixian paint:";
const TALK_VARIANT = "standard-dialogue";
const ITEM_VARIANT = "using-items-on-the-elite-void-knight-using-";
const VARIANT_ORNAMENTED = `${ITEM_VARIANT}ornamented-void-items-elite-void-top-or-elite-void-bottom`;
const VARIANT_OTHER = `${ITEM_VARIANT}any-other-item`;
const PRESET_TEXT = "Preset items cannot be used for this.";
const SHORT_TEXT = `You need ${COST} points to claim that reward.`;
const NUMBER_PLACEHOLDER = "[number]";

let api = null;
let core = null;
/** Upgrade by plain item id: { elite, variant, stepId }. Built by register. */
let upgrades = new Map();
let byStepId = new Map();
let notUpgradable = new Set();
const pending = new WeakMap();

function diaryDone(player) {
  const request = { player, diary: DIARY, tier: TIER, complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const Item = core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

/** The transcript's "If/Before/After ..." conditions for her talk-to conversation. */
function condition({ player, npcId, text }) {
  if (npcId !== core.NpcIdentifiers.ELITE_VOID_KNIGHT) return null;
  if (text === CONDITION_BEFORE) return !diaryDone(player);
  if (text === CONDITION_AFTER) return diaryDone(player);
  if (text === CONDITION_AFTER_PAINT) return false;
  return null;
}

function play(player, event, variant) {
  const request = { player, npc: event.target, npcId: event.npcId, variant, exact: true, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function slotOf(player, item, slot) {
  const items = player.getInventory().getItems();
  return Number.isInteger(slot) && items[slot] === item ? slot : items.indexOf(item);
}

/** An item used on the knight. */
function useOnKnight(event) {
  const { player, item, itemId } = event;
  if (event.npcId !== core.NpcIdentifiers.ELITE_VOID_KNIGHT) return;
  const upgrade = upgrades.get(itemId);
  if (!upgrade) {
    event.handled = play(player, event, notUpgradable.has(itemId) ? VARIANT_ORNAMENTED : VARIANT_OTHER);
    return;
  }
  event.handled = true;
  if (!diaryDone(player)) {
    play(player, event, TALK_VARIANT);
    return;
  }
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (PestRewards.getPoints(player) < COST) {
    player.sendMessage(SHORT_TEXT);
    return;
  }
  pending.set(player, { item, slot: slotOf(player, item, event.slot), itemId, upgrade });
  play(player, event, upgrade.variant);
}

/** The transcript's "The Elite Void Knight upgrades your armour..." step is where the upgrade happens. */
function upgradeOnConfirm(action) {
  const { player } = action;
  const upgrade = byStepId.get(action.stepId);
  if (action.kind !== "message" || action.npcId !== core.NpcIdentifiers.ELITE_VOID_KNIGHT || !upgrade) return;
  const request = pending.get(player);
  pending.delete(player);
  const inventory = player.getInventory();
  const stillThere = request?.upgrade === upgrade && request.slot >= 0
    && inventory.getItems()[request.slot] === request.item && request.item.getId() === request.itemId;
  if (!stillThere || !diaryDone(player) || restricted(request.item)) {
    action.end = true;
    return;
  }
  if (PestRewards.getPoints(player) < COST) {
    player.sendMessage(SHORT_TEXT);
    action.end = true;
    return;
  }
  PestRewards.setPoints(player, PestRewards.getPoints(player) - COST);
  request.item.setId(upgrade.elite);
  inventory.refreshItems();
  // The elite top and robe are in the Wiki's Pest Control collection log, and this is now the way to get them.
  api.emitCustomEvent("collection-log:obtain", { player, itemId: upgrade.elite, amount: 1 });
  // The transcript step is sent as it is unless taken over here: it names the points that are left.
  action.handled = true;
  player.sendMessage(String(action.text).replace(NUMBER_PLACEHOLDER, String(PestRewards.getPoints(player))));
}

function logout({ player }) {
  pending.delete(player);
}

function definePieces() {
  const I = core.ItemIdentifiers;
  upgrades = new Map([
    [I.VOID_KNIGHT_TOP, { elite: I.ELITE_VOID_TOP, variant: `${ITEM_VARIANT}the-void-knight-top`, stepId: "UjckMU" }],
    [I.VOID_KNIGHT_ROBE, { elite: I.ELITE_VOID_ROBE, variant: `${ITEM_VARIANT}the-void-knight-robe`, stepId: "VI-1el" }],
  ]);
  byStepId = new Map([...upgrades.values()].map((upgrade) => [upgrade.stepId, upgrade]));
  // Elite pieces (every variant) and the ornamented plain ones cannot be upgraded.
  notUpgradable = new Set([
    "ELITE_VOID_TOP", "ELITE_VOID_TOP_L_", "ELITE_VOID_TOP_OR_", "ELITE_VOID_TOP_L_OR_",
    "ELITE_VOID_ROBE", "ELITE_VOID_ROBE_L_", "ELITE_VOID_ROBE_OR_", "ELITE_VOID_ROBE_L_OR_",
    "VOID_KNIGHT_TOP_OR_", "VOID_KNIGHT_TOP_L_OR_", "VOID_KNIGHT_ROBE_OR_", "VOID_KNIGHT_ROBE_L_OR_",
  ].map((name) => I[name]).filter(Number.isInteger));
}

module.exports = {
  name: "EliteVoidKnight",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    definePieces();
    api.onNpcDialogueCondition(condition);
    api.onItemOnNpc(useOnKnight, { noted: false });
    api.onCustomEvent("npc-dialogue:action", upgradeOnConfirm);
    api.onPlayerLogout(logout);
  },
};

/**
 * Robin (NPC 2995, the Green Ghost, Port Phasmatys; Wiki: Robin, Morytania Diary rewards): his Claim-slime
 * option turns the player's bones into the same kind of bonemeal and a bucket of slime each, 13 / 26 / 39
 * a day by medium / hard / elite. His refusals are the Wiki transcript in npc-dialogues.json (variant
 * standard-dialogue-using-the-right-click-claim-slime-option); this unit answers its conditions and does
 * the exchange at its "Robin hands you some buckets of slime and bonemeal." step.
 *
 * As captured (rsprox 703 rev 229, 1857 rev 227): the third option; the bones become their bonemeal in
 * their own slots and the slime fills the next free slots; varbit 4543 (MORYTANIA_SLIME_CLAIMED) climbs by
 * one per bone; "You have claimed 11/39 buckets of slime and bonemeal today." is a game message, then the
 * item box (bucket of slime, bonemeal) with the transcript's words; with no bones Robin says "You do not
 * have any bones for me to convert for you."
 *
 * NOT captured, so inferred: the diary refusal, the daily-limit and no-space lines are the transcript's;
 * the tier is the highest Morytania tier claimed from the diary master (the captured player had the elite
 * one; the Wiki says "completion"); a claim with more bones than the day has left converts what is left;
 * preset, untradeable or unbankable bones (and noted ones, which have no bonemeal) are not accepted, as
 * their restrictions would otherwise be laundered into clean items; the counter returns to 0 at 00:00 UTC
 * online, as Zaff's barrel does, since the Wiki gives the limit per day.
 *
 * Nothing is taken until the box step, which checks the tier, the bones, the room and the day's allowance
 * again. The reset has its own task key (other systems call TaskManager.cancelTasks(player)) and logout
 * cancels it.
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const Ectofuntus = require("../../skills/ectofuntus/Common.Ectofuntus");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const TICK_MS = 600;
const DAILY_KEY = "robin-slime";
const VARIANT = "standard-dialogue-using-the-right-click-claim-slime-option";
const BOX_TEXT = "Robin hands you some buckets of slime and bonemeal.";
const NO_DIARY = "Without at least the medium Morytania Diary completed:";
const NO_BONES = "If the player has no bones in their inventory:";
const HAS_BONES = "If the player has bones in their inventory:";
const AT_LIMIT = "If the player has hit their daily limit:";
const NO_SPACE = "If the player does not have enough free inventory slots:";

let pluginApi;
let core;

function data() {
  return Rewards.DATA.robin;
}

/** Bones a day from the highest Morytania tier claimed from the diary master, or 0. */
function limit(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY);

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so Robin takes none. */
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** [slot, bonemeal id] of every inventory bone Robin accepts, in slot order. */
function acceptedBones(player) {
  const found = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (!item || item.getAmount() !== 1 || restricted(item)) return;
    const bonemeal = Ectofuntus.bonemealFor(item.getId());
    if (bonemeal !== null) found.push([slot, bonemeal]);
  });
  return found;
}

/** The bones he converts now: what the player holds, up to what is left of the day. */
function convertible(player) {
  return Math.max(0, Math.min(acceptedBones(player).length, limit(player) - used(player)));
}

function isRobin(npcId) {
  return npcId === core.NpcIdentifiers.ROBIN;
}

function condition({ player, npcId, text }) {
  if (!isRobin(npcId)) return null;
  switch (text) {
    case NO_DIARY: return limit(player) === 0;
    case NO_BONES: return acceptedBones(player).length === 0;
    case HAS_BONES: return acceptedBones(player).length > 0;
    case AT_LIMIT: return used(player) >= limit(player);
    case NO_SPACE: return player.getInventory().getFreeSlots() < convertible(player);
    default: return null;
  }
}

/** Bones in place become bonemeal, one slime each follows; everything is checked again here. */
function exchange(player) {
  const count = convertible(player);
  if (limit(player) === 0 || count === 0 || player.getInventory().getFreeSlots() < count) return false;
  const inventory = player.getInventory();
  for (const [slot, bonemeal] of acceptedBones(player).slice(0, count)) {
    inventory.setItem(slot, new core.Item(bonemeal, 1));
  }
  inventory.adds(core.ItemIdentifiers.BUCKET_OF_SLIME, count);
  inventory.refreshItems();
  for (let i = 0; i < count; i++) Rewards.sendCount(player, data().varbit, Rewards.useDaily(player, DAILY_KEY));
  player.sendMessage(`You have claimed ${used(player)}/${limit(player)} buckets of slime and bonemeal today.`);
  scheduleReset(player);
  return true;
}

function action(event) {
  if (!isRobin(event.npcId) || event.kind !== "message" || event.text !== BOX_TEXT) return;
  if (!exchange(event.player)) {
    event.end = true;
    return;
  }
  event.box = { items: [core.ItemIdentifiers.BUCKET_OF_SLIME, core.ItemIdentifiers.BONEMEAL] };
}

function claimSlime({ player, npc }) {
  const request = { player, npc, npcId: npc.getId(), variant: VARIANT, exact: true, handled: false };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/** Ticks from now to the next 00:00 UTC, at least one. */
function ticksToReset() {
  const now = Date.now();
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / TICK_MS));
}

/**
 * Each player's reset has its own task key, not the player: other systems call
 * TaskManager.cancelTasks(player) (Misthalin Mystery's rowboat, among others) and would end it until a
 * relog. Logout cancels it explicitly.
 */
const RESET_KEYS = new WeakMap();

function resetKey(player) {
  if (!RESET_KEYS.has(player)) RESET_KEYS.set(player, {});
  return RESET_KEYS.get(player);
}

function cancelReset({ player }) {
  core.TaskManager.cancelTasks(resetKey(player));
  RESET_KEYS.delete(player);
}

/** Sends the counter back to 0 once the UTC day has turned; arming replaces the earlier reset. */
function scheduleReset(player) {
  const { Task, TaskManager } = core;
  const key = resetKey(player);
  TaskManager.cancelTasks(key);
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticksToReset(), key, false); }
    execute() {
      this.stop();
      if (used(player) > 0) scheduleReset(player);
      else Rewards.sendCount(player, data().varbit, 0);
    }
  })());
}

function syncOnLogin({ player }) {
  const count = used(player);
  if (count === 0) return;
  Rewards.sendCount(player, data().varbit, count);
  scheduleReset(player);
}

module.exports = function attachRobin(api) {
  pluginApi = api;
  core = api.core;
  if (!Ectofuntus.core) Ectofuntus.init(api);
  api.onNpcInteraction(data().npc, { "Claim-slime": claimSlime });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onPlayerLogin(syncOnLogin);
  api.onPlayerLogout(cancelReset);
};

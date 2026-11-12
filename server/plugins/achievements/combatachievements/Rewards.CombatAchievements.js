/**
 * Claiming tier rewards from Ghommal or Laidee Gnonock, and using their antique lamps.
 *
 * Ghommal's Wiki transcript (npc-dialogues.json) already holds the conversation: while a tier is
 * unlocked and unclaimed, Talk-to plays its "combat-achievement-rewards" variant, whose conditions
 * this answers (the lowest such tier; the free inventory space). As captured claiming a tier (a
 * Leagues VI recording at its tutor), continuing past "Yes please!" sets
 * the tier's status to 2 (claimed) and its lamp as claimed, and puts the lamp and the hilt in the
 * inventory as the next line ("There you go...") opens. Normal-world NPC roles and lines
 * are from the Wiki, not established by that recording.
 *
 * The lamps, as captured: rubbing opens xpreward with the lamp's level (varp 261), and the
 * chosen skill's experience comes with "<col=0000ff>Your wish has been granted!</col><br>You have
 * been awarded 5,000 Runecraft experience!". Experience and level per tier from the Wiki.
 */
const Data = require("./Data.CombatAchievements");
const Progress = require("./Progress.CombatAchievements");

const REWARD_NPCS = new Set(["Ghommal", "Laidee Gnonock"]);
const rewardSessions = new WeakMap();
const CLAIM_DISTANCE = 5;
const REWARDS_VARIANT = "combat-achievement-rewards";
const TIER_CONDITION =
  /^If the player has completed the (easy|medium|hard|elite|master|grandmaster) Combat Achievements:$/i;
const SPACE_CONDITION = /^If the player doesn't have \d+ inventory spaces:$/i;
/** The line the player continues past to take the rewards (Grandmaster has its own). */
const CLAIM_LINES = new Set([
  "Yes please!",
  "You have come very far. You have earned these rewards.",
]);
/** Master tier also hands over Ghommal's lucky penny (Wiki). */
const MASTER_TIER = 5;

/** Wiki, Combat Achievements: each tier's antique lamp, as [experience, lowest skill level]. */
const LAMPS = [
  [5000, 20],
  [10000, 30],
  [15000, 40],
  [25000, 50],
  [35000, 60],
  [50000, 70],
];

const pendingClaim = new WeakMap();
const pendingRub = new WeakMap();
let pluginApi;

const isRewardNpc = (definition) => REWARD_NPCS.has(definition?.getName?.());
function validPlayer(player) {
  const C = pluginApi.core;
  return (
    player.isRegistered() &&
    player.getHitpoints() > 0 &&
    player.getStatus() === C.PlayerStatus.NONE &&
    !player.isNeedsPlacement() &&
    !player.isTeleportingReturn() &&
    !player.getForceMovement()
  );
}
function validContext(player, context) {
  if (
    !context ||
    rewardSessions.get(player) !== context ||
    !validPlayer(player)
  )
    return false;
  const npc = context.npc;
  return (
    npc.isRegistered() &&
    npc.getHitpoints() > 0 &&
    npc.getPrivateArea() === player.getPrivateArea() &&
    (!npc.isOwnerOnly() || npc.getOwner() === player) &&
    player.getLocation().isWithinDistance(npc.getLocation(), CLAIM_DISTANCE)
  );
}
function rememberInteraction(event) {
  const { player, npc, definition } = event;
  pendingClaim.delete(player);
  rewardSessions.delete(player);
  if (
    !isRewardNpc(definition) ||
    definition.getActions()?.[(event.clickType ?? 1) - 1]?.toLowerCase() !==
      "talk-to" ||
    !validPlayer(player)
  )
    return;
  const context = { npc };
  rewardSessions.set(player, context);
  if (!validContext(player, context)) rewardSessions.delete(player);
}
function logout({ player }) {
  pendingClaim.delete(player);
  pendingRub.delete(player);
  rewardSessions.delete(player);
}

function rewardItems(tier) {
  const items = [tier.lamp, tier.hilt];
  if (tier.tier === MASTER_TIER)
    items.push(pluginApi.core.ItemIdentifiers.GHOMMALS_LUCKY_PENNY);
  return items;
}

function dialogueVariant({ player, definition }) {
  if (!isRewardNpc(definition)) return null;
  return Progress.claimableTiers(player).length ? REWARDS_VARIANT : null;
}

function dialogueCondition({ player, definition, text }) {
  if (!isRewardNpc(definition)) return null;
  const tierMatch = TIER_CONDITION.exec(String(text).trim());
  if (tierMatch) {
    const next = Progress.claimableTiers(player)[0];
    const asked = Data.tiers().find(
      (tier) => tier.name.toLowerCase() === tierMatch[1].toLowerCase(),
    );
    if (!next || asked !== next) return false;
    pendingClaim.set(player, {
      tier: next,
      context: rewardSessions.get(player),
    });
    return true;
  }
  if (SPACE_CONDITION.test(String(text).trim())) {
    const request = pendingClaim.get(player);
    // The claim runs before this lazy branch. Retain its result so granting the
    // items cannot turn a successful hand-out into the no-space conversation.
    if (request?.granted) {
      pendingClaim.delete(player);
      return false;
    }
    const tier = request?.tier;
    return (
      !tier || player.getInventory().getFreeSlots() < rewardItems(tier).length
    );
  }
  return null;
}

function claim(player, tier, request = pendingClaim.get(player)) {
  if (
    !request ||
    pendingClaim.get(player) !== request ||
    request.tier !== tier ||
    !validContext(player, request.context)
  )
    return;
  pendingClaim.delete(player);
  if (Progress.tierStatus(player, tier) !== 1) return;
  const core = pluginApi.core,
    inventory = player.getInventory(),
    copy = new core.Inventory(player);
  copy
    .getItems()
    .splice(
      0,
      inventory.getItems().length,
      ...inventory.getItems().map((i) => i.clone()),
    );
  for (const itemId of rewardItems(tier)) {
    const item = new core.Item(itemId, 1);
    if (copy.getAddableAmount(item) < 1) {
      inventory.full();
      return;
    }
    copy.add(item, false);
  }
  inventory.getItems().splice(0, copy.getItems().length, ...copy.getItems());
  Progress.setClaimed(player, tier);
  pendingClaim.set(player, { ...request, granted: true });
  inventory.refreshItems();
  pluginApi.emitCustomEvent("persistence:save", {
    player,
    reason: "combat-achievement-tier-reward",
  });
}
function dialogueLine(request) {
  if (!isRewardNpc(request?.definition) || !CLAIM_LINES.has(request.text))
    return;
  const { player } = request,
    pending = pendingClaim.get(player);
  if (
    !pending ||
    !validContext(player, pending.context) ||
    pending.context.npc !== request.npc
  )
    return;
  request.after = () => claim(player, pending.tier, pending);
}

/** Wiki: the full thrall-duration extension requires claiming Master rewards. */
function thrallDuration(event) {
  if (Progress.claimedTiers(event.player).has(MASTER_TIER)) event.ticks *= 2;
}

const lampTier = (itemId) =>
  Data.tiers().find((tier) => tier.lamp === itemId) ?? null;

function rubLamp({ player, item, itemId, slot }) {
  const tier = lampTier(itemId);
  if (!tier) return false;
  if (
    !validPlayer(player) ||
    player.getInventory().get(slot) !== item ||
    item.getId() !== itemId ||
    item.getMeta() ||
    !Progress.claimedTiers(player).has(tier.tier)
  )
    return true;
  const [experience, minLevel] = LAMPS[tier.index];
  const request = { item, itemId, tier: tier.tier, slot, experience, minLevel };
  pendingRub.set(player, request);
  pluginApi.emitCustomEvent("xpreward:open", {
    player,
    minLevel,
    onConfirm: (skill, name) => grantLamp(player, request, skill, name),
  });
  return true;
}

/** The message box text, or null when the lamp is kept. */
function grantLamp(player, request, skill, name = skill.getName()) {
  if (
    pendingRub.get(player) !== request ||
    !validPlayer(player) ||
    request.item.getId() !== request.itemId ||
    request.item.getMeta() ||
    !Progress.claimedTiers(player).has(request.tier)
  )
    return null;
  pendingRub.delete(player);
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item) return null;
  const manager = player.getSkillManager();
  if (manager.getMaxLevel(skill) < request.minLevel) return null;
  const before = manager.getExperience(skill);
  manager.addExperience(skill, request.experience, true);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  pluginApi.emitCustomEvent("persistence:save", {
    player,
    reason: "combat-achievement-lamp",
  });
  return `<col=0000ff>Your wish has been granted!</col><br>You have been awarded ${request.experience.toLocaleString("en-GB")} ${name} experience!`;
}

module.exports = function attachRewards(api) {
  pluginApi = api;
  api.onBeforeNpcInteraction(rememberInteraction);
  api.onPlayerLogout(logout);
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:line", dialogueLine);
  api.onCustomEvent("magic:thrall-duration", thrallDuration);
  api.onItemAction("Antique lamp", { Rub: rubLamp });
};

Object.assign(module.exports, {
  LAMPS,
  rewardItems,
  dialogueVariant,
  dialogueCondition,
  dialogueLine,
  claim,
  rubLamp,
  grantLamp,
});

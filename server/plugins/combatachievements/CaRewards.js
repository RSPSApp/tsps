/**
 * Claiming a tier's rewards from Ghommal, and the antique lamps they include.
 *
 * Ghommal's Wiki transcript (npc-dialogues.json) already holds the conversation: while a tier is
 * unlocked and unclaimed, Talk-to plays its "combat-achievement-rewards" variant, whose conditions
 * this answers (the lowest such tier; the free inventory space). As captured claiming a tier (a
 * Leagues VI recording; the claim is the same on every world), continuing past "Yes please!" sets
 * the tier's status to 2 (claimed) and its lamp as claimed, and puts the lamp and the hilt in the
 * inventory as the next line ("There you go...") opens.
 *
 * The lamps, as captured: rubbing opens xpreward with the lamp's level (varp 261), and the
 * chosen skill's experience comes with "<col=0000ff>Your wish has been granted!</col> You have
 * been awarded 5,000 Runecraft experience!". Experience and level per tier from the Wiki.
 */
const Data = require("./CaData");
const Progress = require("./CaProgress");

const GHOMMAL = "Ghommal";
const REWARDS_VARIANT = "combat-achievement-rewards";
const TIER_CONDITION = /^If the player has completed the (easy|medium|hard|elite|master|grandmaster) Combat Achievements:$/i;
const SPACE_CONDITION = /^If the player doesn't have \d+ inventory spaces:$/i;
/** The line the player continues past to take the rewards (Grandmaster has its own). */
const CLAIM_LINES = new Set(["Yes please!", "You have come very far. You have earned these rewards."]);
/** Master tier also hands over Ghommal's lucky penny (Wiki). */
const MASTER_TIER = 5;

/** Wiki, Combat Achievements: each tier's antique lamp, as [experience, lowest skill level]. */
const LAMPS = [[5000, 20], [10000, 30], [15000, 40], [25000, 50], [35000, 60], [50000, 70]];

const pendingClaim = new WeakMap();
const pendingRub = new WeakMap();
let pluginApi;

function bind(api) {
  pluginApi = api;
}

const isGhommal = (definition) => definition?.getName?.() === GHOMMAL;

function rewardItems(tier) {
  const items = [tier.lamp, tier.hilt];
  if (tier.tier === MASTER_TIER) items.push(pluginApi.core.ItemIdentifiers.GHOMMALS_LUCKY_PENNY);
  return items;
}

function dialogueVariant({ player, definition }) {
  if (!isGhommal(definition)) return null;
  return Progress.claimableTiers(player).length ? REWARDS_VARIANT : null;
}

function dialogueCondition({ player, definition, text }) {
  if (!isGhommal(definition)) return null;
  const tierMatch = TIER_CONDITION.exec(String(text).trim());
  if (tierMatch) {
    const next = Progress.claimableTiers(player)[0];
    const asked = Data.tiers().find((tier) => tier.name.toLowerCase() === tierMatch[1].toLowerCase());
    if (!next || asked !== next) return false;
    pendingClaim.set(player, next);
    return true;
  }
  if (SPACE_CONDITION.test(String(text).trim())) {
    const tier = pendingClaim.get(player);
    return !tier || player.getInventory().getFreeSlots() < rewardItems(tier).length;
  }
  return null;
}

function claim(player, tier) {
  if (pendingClaim.get(player) !== tier) return;
  pendingClaim.delete(player);
  if (Progress.tierStatus(player, tier) !== 1) return;
  const items = rewardItems(tier);
  if (player.getInventory().getFreeSlots() < items.length) {
    player.sendMessage(`You need at least ${items.length} inventory spaces.`);
    return;
  }
  Progress.setClaimed(player, tier);
  for (const itemId of items) player.getInventory().addItem(new pluginApi.core.Item(itemId, 1));
}

function dialogueLine(request) {
  if (!isGhommal(request?.definition) || !CLAIM_LINES.has(request.text)) return;
  const tier = pendingClaim.get(request.player);
  if (!tier) return;
  const { player } = request;
  request.after = () => claim(player, tier);
}

const lampTier = (itemId) => Data.tiers().find((tier) => tier.lamp === itemId) ?? null;

function rubLamp({ player, item, itemId, slot }) {
  const tier = lampTier(itemId);
  if (!tier) return false;
  if (player.getInventory().get(slot) !== item) return true;
  const [experience, minLevel] = LAMPS[tier.index];
  const request = { item, slot, experience, minLevel };
  pendingRub.set(player, request);
  pluginApi.emitCustomEvent("xpreward:open", {
    player, minLevel, onConfirm: (skill, name) => grantLamp(player, request, skill, name),
  });
  return true;
}

/** The message box text, or null when the lamp is kept. */
function grantLamp(player, request, skill, name = skill.getName()) {
  if (pendingRub.get(player) !== request) return null;
  pendingRub.delete(player);
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item) return null;
  const manager = player.getSkillManager();
  if (manager.getMaxLevel(skill) < request.minLevel) return null;
  const before = manager.getExperience(skill);
  manager.addExperience(skill, request.experience, false);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  return `<col=0000ff>Your wish has been granted!</col> You have been awarded ${request.experience.toLocaleString("en-GB")} ${name} experience!`;
}

module.exports = { LAMPS, bind, rewardItems, dialogueVariant, dialogueCondition, dialogueLine, claim, rubLamp, grantLamp };

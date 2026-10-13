/**
 * The reward token and the tomes (Wiki, Reward token; captured): Look-at opens trek_rewards with
 * nothing chosen (templetrek_reward_selected 9), a click picks a reward - the cache scripts show
 * its ranges for each token - and Claim swaps the token for the amount its trek earned:
 *
 *   low + floor((high - low) * (points - 325) / (8000 - 325))
 *
 * The tome is a random skill's, in the token's colour; reading it gives that colour's XP.
 */
const Common = require("./Common.TempleTrekking");

const CHOSEN = new Map();
/** if_setevents OP1 (bit 1), as captured on trek_rewards:icons 0-8. */
const ICON_FLAGS = 1 << 1;

function tokenTier(itemId) {
  for (const direction of Object.values(Common.data.directions)) {
    for (const [tier, id] of Object.entries(direction.tokens)) if (id === itemId) return Number(tier);
  }
  return 0;
}

function lookAt(event) {
  const { player, itemId, slot } = event;
  if (!tokenTier(itemId)) return false;
  const { interfaces, rewards } = Common.data;
  CHOSEN.set(player, { slot, itemId, reward: rewards.none });
  Common.varbit(player, "templetrek_reward_token_slot", slot);
  Common.varbit(player, "templetrek_reward_selected", rewards.none);
  const sender = player.getPacketSender();
  sender.sendInterface(interfaces.trek_rewards);
  // As live: the nine reward icons (cc_create children of icons) answer op 1.
  sender.sendInterfaceFlagsRange((interfaces.trek_rewards << 16) | interfaces["trek_rewards:icons"], 0, Common.data.rewards.slots.length - 1, ICON_FLAGS);
  return true;
}

/** The points the oldest token of this kind was earned with (the minimum if none is known). */
function takePoints(player, itemId) {
  const saved = { ...(player.getAttribute(Common.TOKEN_POINTS_ATTRIBUTE) ?? {}) };
  const list = [...(saved[itemId] ?? [])];
  const points = list.shift() ?? Common.data.points.min;
  saved[itemId] = list;
  player.setAttribute(Common.TOKEN_POINTS_ATTRIBUTE, saved);
  return points;
}

function count([low, high], points) {
  const { min, max } = Common.data.points;
  const clamped = Math.max(min, Math.min(max, points));
  return low + Math.floor(((high - low) * (clamped - min)) / (max - min));
}

function give(player, itemId, amount, noted) {
  const { Item, ItemDefinition } = Common.core;
  const noteId = ItemDefinition.forId(itemId)?.getNoteId?.() ?? -1;
  const id = noted && noteId > 0 ? noteId : itemId;
  const item = new Item(id, amount);
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(id)?.isStackable?.() ?? false;
  if ((stackable && (inventory.contains(id) || inventory.getFreeSlots() > 0)) || (!stackable && inventory.getFreeSlots() >= amount)) {
    inventory.adds(id, amount);
    return;
  }
  Common.api.getItemOnGroundManager().registerLocation(player, item, player.getLocation());
}

function itemName(itemId) {
  return Common.core.ItemDefinition.forId(itemId)?.getName?.() ?? "item";
}

/** Grants reward slot `index` for a token of `tier` worth `points`; returns what to show. */
function grant(player, index, tier, points) {
  const { slots, tomes } = Common.data.rewards;
  const slot = slots[index];
  if (slot.random) return grant(player, Common.randomInt(0, slots.length - 2), tier, points);
  if (slot.tome) {
    const skill = Common.randomOf(Object.keys(tomes.items));
    const tome = tomes.items[skill][tier - 1];
    give(player, tome, 1, false);
    return { itemId: tome, text: `You gain ${itemName(tome)} x 1.` };
  }
  const amount = count(slot.ranges[tier - 1], points);
  if (slot.herbs) {
    const low = Math.floor((2 * amount) / 3);
    const herb = Common.randomOf(slot.herbs);
    give(player, herb, low, slot.noted);
    give(player, slot.high, amount - low, slot.noted);
    return { itemId: herb, text: `You gain ${itemName(herb)} x ${low} and ${itemName(slot.high)} x ${amount - low}.` };
  }
  if (slot.coal) {
    const iron = Math.floor(amount / 3);
    give(player, slot.coal, amount - iron, slot.noted);
    give(player, slot.iron, iron, slot.noted);
    return { itemId: slot.coal, text: `You gain ${itemName(slot.coal)} x ${amount - iron} and ${itemName(slot.iron)} x ${iron}.` };
  }
  give(player, slot.item, amount, slot.noted);
  return { itemId: slot.item, text: `You gain ${itemName(slot.item)} x ${amount}.` };
}

function claim(player) {
  const chosen = CHOSEN.get(player);
  if (!chosen || chosen.reward === Common.data.rewards.none) return;
  const inventory = player.getInventory();
  const atSlot = inventory.getItems()[chosen.slot];
  if (atSlot?.getId?.() !== chosen.itemId) {
    if (!inventory.contains(chosen.itemId)) return;
  }
  CHOSEN.delete(player);
  const tier = tokenTier(chosen.itemId);
  const points = takePoints(player, chosen.itemId);
  if (atSlot?.getId?.() === chosen.itemId) inventory.setItem(chosen.slot, new Common.core.Item(-1, 0));
  else inventory.deleteNumber(chosen.itemId, 1);
  inventory.refreshItems();
  player.getPacketSender().sendInterfaceRemoval();
  const { itemId, text } = grant(player, chosen.reward, tier, points);
  Common.itemStatement(player, itemId, text);
}

function rewardsAction(event) {
  const { interfaces } = Common.data;
  if (event.groupId !== interfaces.trek_rewards) return;
  event.handled = true;
  const { player } = event;
  const chosen = CHOSEN.get(player);
  if (!chosen) return;
  if (event.childId === interfaces["trek_rewards:icons"] && Number.isInteger(event.slot) && event.slot >= 0 && event.slot < Common.data.rewards.slots.length) {
    chosen.reward = event.slot;
    Common.varbit(player, "templetrek_reward_selected", event.slot);
  } else if (event.childId === interfaces["trek_rewards:buybutton"]) {
    claim(player);
  }
}

/** Only the rewards interface closing ends the choice (opening it closes whatever was open). */
function interfaceClosed({ player, interfaceId }) {
  if (interfaceId === Common.data.interfaces.trek_rewards) CHOSEN.delete(player);
}

function readTome(event) {
  const { player, itemId, slot } = event;
  const { tomes } = Common.data.rewards;
  for (const [skill, ids] of Object.entries(tomes.items)) {
    const tier = ids.indexOf(itemId);
    if (tier < 0) continue;
    const inventory = player.getInventory();
    if (inventory.getItems()[slot]?.getId?.() === itemId) inventory.setItem(slot, new Common.core.Item(-1, 0));
    else inventory.deleteNumber(itemId, 1);
    inventory.refreshItems();
    player.getSkillManager().addExperience(Common.core.Skill[skill], Common.randomInt(...tomes.xp[tier]), false);
    const name = skill.charAt(0) + skill.slice(1).toLowerCase();
    Common.itemStatement(player, itemId, `After reading the magical tome, you gain some experience in ${name}. The book magically disappears.`);
    return true;
  }
  return false;
}

function attachRewards(api) {
  api.onItemAction("Reward token", { "Look-at": lookAt });
  for (const skill of Object.keys(Common.data.rewards.tomes.items)) {
    api.onItemAction(`${skill.charAt(0)}${skill.slice(1).toLowerCase()} tome`, { Read: readTome });
  }
  api.onInterfaceActionClick(rewardsAction);
  api.onCustomEvent("interface:closed", interfaceClosed);
}

module.exports = { attachRewards, count, grant };

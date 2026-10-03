"use strict";

const H = { api: null, core: null, data: null, tick: 0, players: new Set(), traps: new Set(), actions: new Map(), reserved: new Map(), hidden: new Map() };
const ANIM = Object.freeze({ SET: 5208, TAKE: 5207, SMALL: 5212, NET: 6605, OLD_NET: 6606, BUTTERFLY: 5209, HANDS: 782, FALCON: 5162, NOOSE: 5255, TEASE: 5236, JUMP: 3067, BIRDHOUSE: 7057, BIRDHOUSE_IMCANDO: 8916, KICK: 423, PICKUP: 827, HERBI_APPEAR: 7687, HERBI_STUN: 7688, HERBI_BURROW: 7690, CAT_FALL: 5234, ANTELOPE_FALL: 10928 });

function level(player, skill = H.core.Skill.HUNTER) {
  return player.getSkillManager().getCurrentLevel(skill);
}

function requireLevel(player, required, skill = H.core.Skill.HUNTER) {
  if (level(player, skill) >= required) return true;
  player.sendMessage(`You need level ${required} ${skill.getName()} to do this.`);
  return false;
}

function hasTool(player, id) {
  const I = H.core.ItemIdentifiers;
  const ids = id === I.HAMMER ? [I.HAMMER, I.IMCANDO_HAMMER, I.IMCANDO_HAMMER_OFF_HAND_] : id === I.KNIFE ? [I.KNIFE, I.FLETCHING_KNIFE] : [id];
  return ids.some(tool => Number.isInteger(tool) && (player.getInventory().contains(tool) || player.getEquipment().getItems().some(item => item?.getId() === tool)));
}

function distance(a, b) {
  if (a.getZ() !== b.getZ()) return Infinity;
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function nearby(player, entity, range = 2) {
  return player.getPrivateArea() === entity.getPrivateArea() && distance(player.getLocation(), entity.getLocation()) <= range;
}

function active(player) {
  return player.isRegistered() && player.getHitpoints() > 0;
}

function available(npc) {
  return npc.isRegistered() && npc.isVisible() && npc.getHitpoints() > 0 && !npc.isDyingFunction()
    && !npc.untargetable && !H.reserved.has(npc) && !H.hidden.has(npc);
}

function roll(min, max = min) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function rewardItems(loot) {
  return loot.map(([id, min, max]) => [id, roll(min, max ?? min)]);
}

// Preflight the complete exchange, including stacks and slots freed by inputs.
// ItemContainer.addItems itself can partially add; Hunter must never consume a
// trap/jar/clockwork and then lose the reward because a later item does not fit.
function exchange(player, remove, add, commit = true) {
  const inv = player.getInventory();
  const counts = new Map();
  for (const item of inv.getItems()) {
    if (item && item.getId() > 0 && item.getAmount() > 0) counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount());
  }
  for (const [id, amount] of remove) {
    if (!Number.isInteger(id) || !Number.isInteger(amount) || amount <= 0 || (counts.get(id) ?? 0) < amount) return false;
    counts.set(id, counts.get(id) - amount);
  }
  for (const [id, amount] of add) {
    if (!Number.isInteger(id) || !Number.isInteger(amount) || id <= 0 || amount <= 0) return false;
    const total = (counts.get(id) ?? 0) + amount;
    if (total > 2147483647) return false;
    counts.set(id, total);
  }
  let slots = 0;
  for (const [id, amount] of counts) {
    if (amount > 0) slots += H.core.ItemDefinition.forId(id).isStackable() ? 1 : amount;
  }
  if (slots > inv.capacity()) return false;
  if (commit) {
    for (const [id, amount] of remove) inv.deleteNumber(id, amount);
    for (const [id, amount] of add) inv.adds(id, amount);
  }
  return true;
}

function drop(player, items, location, area = player.getPrivateArea()) {
  for (const [id, amount] of items) {
    if (H.core.ItemDefinition.forId(id).isStackable()) {
      H.core.ItemOnGroundManager.registerLocation(player, new H.core.Item(id, amount), location.clone(), area);
    } else {
      for (let i = 0; i < amount; i++) H.core.ItemOnGroundManager.registerLocation(player, new H.core.Item(id, 1), location.clone(), area);
    }
  }
}

/** Only chinchompas roll the baby chinchompa (Wiki base chances). */
function chinchompaPetBase(npcId) {
  const N = H.core.NpcIdentifiers;
  if (npcId === N.CHINCHOMPA) return 131395;
  if (npcId === N.CARNIVOROUS_CHINCHOMPA) return 98373;
  if (npcId === N.BLACK_CHINCHOMPA) return 82758;
  return undefined;
}

function xp(player, amount, method, npcId, extra = {}) {
  player.getSkillManager().addExperiences(H.core.Skill.HUNTER, amount);
  H.api.emitCustomEvent("hunter:success", { player, skill: H.core.Skill.HUNTER, method, npcId, xp: amount, petBase: chinchompaPetBase(npcId), ...extra });
}

// OSRS Wiki Module:Skilling success chart: rounded interpolation on a 256-roll.
function probability(low, high, l) {
  return Math.max(0, Math.min(1, (Math.floor(low + (high - low) * (l - 1) / 98 + 0.5) + 1) / 256));
}

function outfit(player) {
  const I = H.core.ItemIdentifiers;
  return [I.GUILD_HUNTER_HEADWEAR, I.GUILD_HUNTER_TOP, I.GUILD_HUNTER_LEGS, I.GUILD_HUNTER_BOOTS]
    .every(id => player.getEquipment().getItems().some(item => item?.getId() === id));
}

function chance(player, creature, bonus = 0, required = creature.level) {
  const l = level(player);
  if (l < required) return false;
  return Math.random() < Math.min(1, probability(creature.low, creature.high, l) + bonus + (outfit(player) ? 0.025 : 0));
}

function choose(player, entries, entity = null) {
  player.getDialogueManager().startDialogues(new H.core.DialogueChainBuilder().add(new H.core.OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      if (active(player) && (!entity || nearby(player, entity))) entries[Number(option)]?.[1]();
    },
  }, ...entries.map(([text]) => text))));
}

function cancel(player) {
  const action = H.actions.get(player);
  if (!action) return;
  H.actions.delete(player);
  action.cancel?.();
  player.performAnimation(H.core.Animation.DEFAULT_RESET_ANIMATION);
}

function begin(player, ticks, animation, finish, onCancel) {
  if (!active(player) || player.busy() || H.actions.has(player)) return false;
  player.getSkillManager().stopSkillable();
  H.players.add(player);
  H.actions.set(player, { due: H.tick + ticks, location: player.getLocation().clone(), area: player.getPrivateArea(), finish, cancel: onCancel });
  player.performAnimation(new H.core.Animation(animation));
  return true;
}

function processActions() {
  for (const [player, action] of H.actions) {
    if (!active(player) || player.getPrivateArea() !== action.area || !player.getLocation().equals(action.location)
      || player.getCombat().getTarget() || player.getCombat().getAttacker()) {
      cancel(player);
    } else if (H.tick >= action.due) {
      H.actions.delete(player);
      player.performAnimation(H.core.Animation.DEFAULT_RESET_ANIMATION);
      action.finish();
    }
  }
}

function hide(npc, ticks = 10, animationTicks = 0) {
  H.reserved.delete(npc);
  const queue = npc.getMovementQueue();
  H.hidden.set(npc, { due: H.tick + ticks, blocked: queue.isMovementBlocked(), untargetable: npc.untargetable, hideAt: H.tick + animationTicks });
  queue.reset();
  queue.setBlockMovement(true);
  npc.getCombat().reset();
  npc.untargetable = true;
  if (!animationTicks) npc.setVisible(false);
}

function reveal(npc) {
  const state = H.hidden.get(npc);
  H.hidden.delete(npc);
  if (!state || !npc.isRegistered()) return;
  npc.moveTo(npc.getSpawnPosition());
  npc.getMovementQueue().setBlockMovement(state.blocked);
  npc.untargetable = state.untargetable;
  npc.setVisible(true);
}

function processHidden() {
  for (const [npc, state] of H.hidden) {
    if (H.tick >= state.due || !npc.isRegistered()) reveal(npc);
    else if (H.tick >= state.hideAt && npc.isVisible()) npc.setVisible(false);
  }
}

function removeObject(object) {
  H.core.ObjectManager.deregister(object, true);
  object.getPrivateArea()?.detach(object);
  // Runtime traps have no base-map counterpart to suppress on region reload.
  const removed = H.core.World.getRemovedObjects();
  const index = removed.indexOf(object);
  if (index !== -1) removed.splice(index, 1);
}

function ownsClue(player, tier) {
  const names = [`Clue scroll (${tier.toLowerCase()})`, `Clue bottle (${tier.toLowerCase()})`,
    `Clue nest (${tier.toLowerCase()})`, `Scroll box (${tier.toLowerCase()})`];
  const contains = container => container?.getItems?.().some(item => item?.getAmount() > 0
    && names.includes(H.core.ItemDefinition.forId(item.getId()).getName()));
  return contains(player.getInventory()) || Array.from({ length: H.core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(contains);
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  H.api.emitCustomEvent("quest:is-complete", request);
  return typeof request.complete === "boolean" ? request.complete : Number(player.getAttribute(`quest.${key}.stage`)) >= 2;
}

module.exports = { H, ANIM, level, requireLevel, hasTool, distance, nearby, active, available, roll, rewardItems,
  exchange, drop, xp, probability, outfit, chance, choose, cancel, begin, processActions, hide, reveal, processHidden, removeObject, questComplete, ownsClue };

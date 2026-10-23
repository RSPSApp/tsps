"use strict";

// Sources: OSRS Wiki Treasure Trails, Scroll case, Scroll box and Mimic scroll case.
// X Marks the Spot unlocks boxes and the combined cap; only one clue is active.
const TIERS = Object.freeze(["beginner", "easy", "medium", "hard", "elite", "master"]);
const MIMIC_ATTRIBUTE = "treasure-trails:mimic-case";
const CASE_ATTRIBUTES = Object.freeze(Object.fromEntries(TIERS.map(tier => [tier, Object.freeze({
  minor: `treasure-trails:${tier}-minor-case`, major: `treasure-trails:${tier}-major-case`,
})])));
const MINOR_ATTRIBUTE = CASE_ATTRIBUTES.beginner.minor;
const MAJOR_ATTRIBUTE = CASE_ATTRIBUTES.beginner.major;
const FORM = /^(Clue scroll|Scroll box|Clue bottle|Clue nest|Clue geode) \((beginner|easy|medium|hard|elite|master)\)$/;
let api, core;
let cases = new Map(), forms = new Map();

function classify(id) {
  if (!forms.has(id)) {
    const match = FORM.exec(core.ItemDefinition.forId(id)?.getName());
    forms.set(id, match ? {form: match[1], tier: match[2]} : null);
  }
  return forms.get(id);
}

function containers(player) {
  return [player.getInventory(), ...Array.from({length: core.Bank.TOTAL_BANK_TABS}, (_, tab) => player.getBank?.(tab))];
}

function boxUnlocked(player) {
  const query = {player, key: "x_marks_the_spot", complete: null};
  api.emitCustomEvent("quest:is-complete", query);
  return query.complete === true;
}

function capacity(player, tier = "beginner") {
  if (!TIERS.includes(tier)) return null;
  if (!boxUnlocked(player)) return 1;
  return 2 + [CASE_ATTRIBUTES[tier].minor, CASE_ATTRIBUTES[tier].major, MIMIC_ATTRIBUTE]
    .filter(key => player.getAttribute(key) === true).length;
}

function count(player, tier = "beginner") {
  return containers(player).reduce((total, container) => total + (container?.getItems?.() ?? []).reduce((sum, item) =>
    sum + (item && classify(item.getId())?.tier === tier ? Math.max(0, item.getAmount()) : 0), 0), 0);
}

function queryCapacity(request) {
  const tier = String(request?.tier).toLowerCase();
  if (request?.player && TIERS.includes(tier)) request.capacity = capacity(request.player, tier);
}

function canReceive(request) {
  const tier = String(request?.tier).toLowerCase();
  if (request?.player && TIERS.includes(tier)) request.allowed = (tier === "beginner" || core.WorldDefinition.isMembersWorld())
    && count(request.player, tier) < capacity(request.player, tier);
}

function clueItem(request) {
  const type = classify(request?.itemId);
  if (!request?.player || !type) return;
  request.box = boxUnlocked(request.player);
  if (request.box) request.itemId = core.ItemIdentifiers[`SCROLL_BOX_${type.tier.toUpperCase()}_`];
}

function prepareTake(request) {
  if (request?.allow !== true || !request.player) return;
  const type = classify(request.itemId);
  if (!type) return;
  if (type.tier !== "beginner" && !core.WorldDefinition.isMembersWorld()) { request.allow = false; return; }
  if (type.form === "Clue scroll" && ownsActiveClue(request.player, type.tier)) {
    request.allow = false;
    request.player.sendMessage("You already have a clue scroll of this tier.");
    return;
  }
  const room = Math.max(0, capacity(request.player, type.tier) - count(request.player, type.tier));
  if (room < 1) {
    request.allow = false;
    request.player.sendMessage(type.form === "Scroll box" ? "You can't take any more of that tier of scroll box."
      : "You already have a clue scroll of this tier.");
    return;
  }
  request.amount = Math.min(request.amount, room);
  if (type.form === "Clue scroll") request.amount = Math.min(request.amount, 1);
  if (type.form === "Scroll box") request.discard = Math.max(request.discard,
    Math.max(0, request.groundItem.getItem().getAmount() - room));
}

function taken(request) {
  if (classify(request?.itemId)?.form !== "Scroll box" || !(request.discarded > 0)) return;
  request.player.sendMessage(request.discarded === 1
    ? "One of your scroll boxes was destroyed as you have too many of that tier."
    : "Some of your scroll boxes were destroyed as you have too many of that tier.");
}

function filterDrops(request) {
  if (!request?.player || !Array.isArray(request.drops)) return;
  const unlocked = boxUnlocked(request.player);
  const remaining = new Map(TIERS.map(tier => [tier, Math.max(0, capacity(request.player, tier) - count(request.player, tier))]));
  for (let index = 0; index < request.drops.length; index++) {
    const drop = request.drops[index], type = classify(drop.itemId);
    if (!type) continue;
    if (type.tier !== "beginner" && !core.WorldDefinition.isMembersWorld()) { request.drops.splice(index--, 1); continue; }
    const room = remaining.get(type.tier);
    if (room < 1) { request.drops.splice(index--, 1); continue; }
    drop.amount = Math.min(drop.amount, room);
    remaining.set(type.tier, room - drop.amount);
    if (type.form === "Clue scroll" || type.form === "Scroll box") {
      drop.itemId = core.ItemIdentifiers[`${unlocked ? "SCROLL_BOX" : "CLUE_SCROLL"}_${type.tier.toUpperCase()}_`];
    }
  }
}

function ownsActiveClue(player, tier) {
  const matches = (id, amount) => amount > 0 && classify(id)?.tier === tier && classify(id).form === "Clue scroll";
  if (containers(player).some(container => container?.getItems?.().some(item => item && matches(item.getId(), item.getAmount())))) return true;
  const storage = {player, grave: null, office: []};
  api.emitCustomEvent("gravestones:state", storage);
  if ([...(storage.grave?.items ?? []), ...(storage.office ?? [])].some(item => item && matches(item.id, item.amount))) return true;
  const retrieval = {player, items: []};
  api.emitCustomEvent("item-retrieval:items", retrieval);
  return retrieval.items.some(item => matches(item.itemId, item.amount));
}

function clicked(event) {
  if (!Number.isInteger(event?.slot)) return null;
  const item = event.player.getInventory().getItems()[event.slot];
  return item?.getAmount() > 0 && (!event.item || event.item === item)
    && (!Number.isInteger(event.itemId) || event.itemId === item.getId()) ? item : null;
}

function openBox(event) {
  const item = clicked(event), type = item && classify(item.getId());
  if (type?.form !== "Scroll box") return false;
  if (type.tier !== "beginner" && !core.WorldDefinition.isMembersWorld()) return true;
  if (ownsActiveClue(event.player, type.tier)) {
    event.player.sendMessage("The clue box refuses to open - you already have a clue.");
    return true;
  }
  const inventory = event.player.getInventory();
  if (item.getAmount() > 1 && inventory.isFull()) {
    event.player.sendMessage("You need an inventory space to open the scroll box.");
    return true;
  }
  inventory.deleteAtSlot(event.slot, 1);
  inventory.adds(core.ItemIdentifiers[`CLUE_SCROLL_${type.tier.toUpperCase()}_`], 1);
  return true;
}

function openVessel(event) {
  const requested = classify(event?.itemId ?? event?.item?.getId());
  // The service owns recognized vessel requests even when their clicked snapshot
  // is stale. Do not let a rejected click fall through to legacy grant handlers.
  if (requested && ["Clue nest", "Clue geode", "Clue bottle"].includes(requested.form)) event.handled = true;
  const item = clicked(event), type = item && classify(item.getId());
  if (!type || !["Clue nest", "Clue geode", "Clue bottle"].includes(type.form)) return;
  event.handled = true;
  if (type.tier !== "beginner" && !core.WorldDefinition.isMembersWorld()) return true;
  const request = {player: event.player, itemId: item.getId(), box: false};
  clueItem(request);
  if (!request.box && ownsActiveClue(event.player, type.tier)) {
    event.player.sendMessage(type.form === "Clue nest" ? "The nest refuses to give up its prize - you already have a clue."
      : "You already have a clue of that tier.");
    return true;
  }
  const inventory = event.player.getInventory();
  const id = request.box ? request.itemId : core.ItemIdentifiers[`CLUE_SCROLL_${type.tier.toUpperCase()}_`];
  const rewards = [id];
  if (type.form === "Clue nest" && core.WorldDefinition.isMembersWorld()) rewards.push(core.ItemIdentifiers.BIRD_NEST_6);
  let slotsNeeded = 0;
  for (const reward of rewards) {
    // These outputs have no metadata. A tagged copy is a different stack,
    // and an existing matching stack must also have room below its limit.
    const matching = core.ItemDefinition.forId(reward).isStackable() && inventory.getItems().some(entry =>
      entry.getId() === reward && JSON.stringify(entry.getMeta() ?? null) === "null");
    if (!matching) slotsNeeded++;
    else if (core.ItemOnGroundManager.inventoryCapacity(event.player, new core.Item(reward)) < 1) {
      inventory.full();
      return true;
    }
  }
  if (inventory.getFreeSlots() + (item.getAmount() === 1 ? 1 : 0) < slotsNeeded) {
    inventory.full();
    return true;
  }
  if (clicked(event) !== item) return true;
  inventory.deleteAtSlot(event.slot, 1);
  for (const reward of rewards) inventory.adds(reward, 1);
  return true;
}

function eligible(player, id) {
  const entry = cases.get(id);
  if (!entry) return null;
  return player.getAttribute(entry.attribute) !== true && !containers(player).some(container =>
    container?.getItems?.().some(item => item?.getId() === id && item.getAmount() > 0));
}

function caseEligible(request) {
  if (request?.player && cases.has(request.itemId)) request.eligible = eligible(request.player, request.itemId);
}

function milestoneRewards(player, completed, milestones) {
  return milestones.filter(row => row.item_id && completed >= row.completed && eligible(player, row.item_id) === true)
    .map(row => ({itemId: row.item_id, amount: 1, noted: false}));
}

function queryMilestones(request) {
  if (request?.handled) return;
  if (request?.player && Array.isArray(request.milestones) && Array.isArray(request.drops)) {
    request.drops.push(...milestoneRewards(request.player, request.completed, request.milestones));
    request.handled = true;
  }
}

function sync({player}) {
  for (const entry of cases.values()) {
    const varbit = core.CacheDefinitions.getVarbitId(entry.varbit);
    if (varbit != null) player.getPacketSender().sendVarbit(varbit, player.getAttribute(entry.attribute) === true ? 1 : 0);
  }
}

function openCase(event) {
  const item = clicked(event), entry = item && cases.get(item.getId());
  if (!entry) return false;
  if (entry.tier !== "beginner" && !core.WorldDefinition.isMembersWorld()) return true;
  if (event.player.getAttribute(entry.attribute) === true) {
    event.player.sendMessage("You have already increased your clue capacity with this scroll case.");
    return true;
  }
  event.player.getInventory().deleteAtSlot(event.slot, 1);
  event.player.setAttribute(entry.attribute, true);
  sync(event);
  api.emitCustomEvent("persistence:save", {player: event.player, reason: "scroll-case"});
  event.player.sendMessage(entry.tier == null ? "You have increased the capacity for all of your clue scrolls by one!"
    : `You can now hold ${capacity(event.player, entry.tier)} ${entry.tier} clues.`);
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi; core = api.core; forms = new Map(); cases = new Map();
  for (const tier of TIERS) {
    for (const kind of ["minor", "major"]) {
      const id = core.ItemIdentifiers[`${kind.toUpperCase()}_${tier.toUpperCase()}_SCROLL_CASE`];
      cases.set(id, {tier, attribute: CASE_ATTRIBUTES[tier][kind], varbit: `scroll_case_${tier}_${kind}`});
    }
    api.onItemAction(`Scroll box (${tier})`, {Open: openBox});
    if (tier !== "master") api.onItemAction(`Clue bottle (${tier})`, {Open: openVessel});
  }
  cases.set(core.ItemIdentifiers.MIMIC_SCROLL_CASE, {tier: null, attribute: MIMIC_ATTRIBUTE, varbit: "scroll_case_mimic"});
  for (const [id, entry] of cases) {
    api.persistAttribute(entry.attribute, false);
    api.onItemAction(core.ItemDefinition.forId(id).getName(), {Open: openCase});
  }
  api.onCustomEvent("treasure-trails:capacity", queryCapacity);
  api.onCustomEvent("treasure-trails:can-receive", canReceive);
  api.onCustomEvent("treasure-trails:clue-item", clueItem);
  api.onCustomEvent("treasure-trails:open-vessel", openVessel);
  api.onCustomEvent("treasure-trails:case-eligible", caseEligible);
  api.onCustomEvent("treasure-trails:milestone-rewards", queryMilestones);
  api.onCustomEvent("ground-items:take", prepareTake);
  api.onCustomEvent("ground-items:taken", taken);
  api.onCustomEvent("npc-drops:roll", filterDrops);
  api.onPlayerLogin(sync);
};
Object.assign(module.exports, {MINOR_ATTRIBUTE, MAJOR_ATTRIBUTE, MIMIC_ATTRIBUTE, CASE_ATTRIBUTES,
  capacity, count, canReceive, filterDrops, openBox, openCase, milestoneRewards, sync});

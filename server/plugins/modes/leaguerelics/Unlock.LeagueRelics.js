/**
 * Choosing a relic: the checks (a league character, a real slot, the tier's points, no pick in
 * that tier yet, a bank when the relic hands out an item), the save, the captured presentation
 * and the items. Also the "New Relic Available!" popup when points cross a tier's cost, and the
 * selection varbits at login. Relics are permanent (Wiki: a tier's choice cannot be changed).
 */
const Common = require("./Common.LeagueRelics");

function uid(group, child) {
  return (group << 16) | child;
}

/**
 * The tiers' picks, and Reloaded's: its extra pick in its tier's selection_other varbit, else (while
 * it is unused) the repick varbits of the tiers it may come from, which client script 3697 reads to
 * mark them (rec 1135).
 */
function sendSelections(player) {
  const sender = player.getPacketSender();
  const picks = Common.chosen(player);
  Common.data.selectionVarbits.forEach((varbit, tier) => sender.sendVarbit(varbit, picks[tier] | 0));
  const type = Common.leagueOf(player);
  const extra = Common.reloadedPick(player, type, picks) ? player.getAttribute(Common.RELOADED_ATTRIBUTE) : null;
  Common.data.selectionOtherVarbits.forEach((varbit, tier) => sender.sendVarbit(varbit, extra?.tier === tier ? extra.slot : 0));
  sendRepick(player, type, !extra && holdsReloaded(type, picks));
  sender.sendVarbit(Common.data.lastViewedVarbit, 0);
}

/** Whether the picks hold Reloaded itself, in a league that has it. */
function holdsReloaded(type, picks) {
  const effect = Common.data.effects.reloaded;
  if (!effect || ![].concat(effect.league).includes(type)) return false;
  return Common.catalog(type).tiers.some((entry, index) => entry.relics[picks[index] - 1]?.key === effect.key);
}

/** The repick varbits: 1 for each tier Reloaded's extra pick may come from while `open`, else 0. */
function sendRepick(player, type, open) {
  const effect = Common.data.effects.reloaded;
  const tiers = open ? Common.reloadedTiers(effect, type) : [];
  const sender = player.getPacketSender();
  Common.data.repickVarbits.forEach((varbit, tier) => sender.sendVarbit(varbit, tiers.includes(tier) ? 1 : 0));
}

/** The items a relic hands out, by id: a name (names the cache no longer has are skipped; the data says which) or a cache id. */
function grantedItems(relic) {
  const { ItemIdentifiers } = Common.core;
  return (relic.grants ?? []).map((name) => (Number.isInteger(name) ? name : ItemIdentifiers[name])).filter((id) => Number.isInteger(id));
}

/**
 * Where an item relic may be unlocked: with the bank open, or (a cache-read league with a `tutor`,
 * Demonic Pacts) within a bank or near its Leagues Tutor, as live says (237/01102). "Within a bank"
 * is a bank loc or banker within the tutor data's `bankReach` (LeagueMode's `league:near-bank`);
 * `reach` and `bankReach` are ours.
 */
function mayReceiveItems(player, type, bankOpen) {
  if (bankOpen) return true;
  const tutor = Common.cacheLeague(type)?.tutor;
  if (!tutor) return false;
  const bank = { player, distance: tutor.bankReach, near: false };
  Common.api.emitCustomEvent("league:near-bank", bank);
  if (bank.near) return true;
  const here = player.getLocation();
  return (player.getLocalNpcs?.() ?? []).some((npc) => npc.getDefinition?.()?.getName?.() === tutor.name
    && npc.getLocation().getZ() === here.getZ() && npc.getLocation().isWithinDistance(here, tutor.reach));
}

/** The bank tabs that hold items (the search tab holds none). */
function bankTabs() {
  const { Bank } = Common.core;
  const tabs = [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) if (tab !== Bank.BANK_SEARCH_TAB_INDEX) tabs.push(tab);
  return tabs;
}

/**
 * Where each item the relic hands out would go, in the order `grant` delivers them, or null when
 * one has nowhere to go (so a permanent pick is never saved without its items). Item-aware: a
 * stackable item joins its stack in the inventory; the bank stacks everything, so an item already
 * banked takes no slot; a new bank stack takes one slot of the player's bank space, which every
 * tab shares (`Bank.freeSlots`), and a slot in its tab; nothing this plan reserves is counted twice.
 */
function deliveryPlan(player, relic) {
  const { Item, Bank } = Common.core;
  const inventory = player.getInventory();
  const tabs = bankTabs();
  const free = {
    inventory: inventory.getFreeSlots(),
    bank: Bank.freeSlots(player),
    tab: new Map(tabs.map((tab) => [tab, player.getBank(tab).getFreeSlots()])),
  };
  const placed = { inventory: new Set(), bank: new Map(tabs.map((tab) => [tab, new Set()])) };
  const steps = [];
  for (const id of grantedItems(relic)) {
    const item = new Item(id, 1);
    const stackable = item.getDefinition().isStackable();
    if (stackable && (placed.inventory.has(id) || (inventory.contains(id) && inventory.getAddableAmount(item) >= 1))) {
      steps.push({ item, tab: -1 });
      continue;
    }
    if (free.inventory > 0) {
      free.inventory--;
      placed.inventory.add(id);
      steps.push({ item, tab: -1 });
      continue;
    }
    const held = tabs.find((tab) => placed.bank.get(tab).has(id) || (player.getBank(tab).contains(id) && player.getBank(tab).getAddableAmount(item) >= 1));
    if (held !== undefined) {
      steps.push({ item, tab: held });
      continue;
    }
    if (free.bank <= 0) return null;
    const tab = [Bank.getTabForItem(player, id), ...tabs].find((candidate) => free.tab.get(candidate) > 0);
    if (tab === undefined) return null;
    free.bank--;
    free.tab.set(tab, free.tab.get(tab) - 1);
    placed.bank.get(tab).add(id);
    steps.push({ item, tab });
  }
  return steps;
}

function canDeliver(player, relic) {
  return deliveryPlan(player, relic) !== null;
}

/** Why a pick is refused (a message key), or null when it may go ahead. `bankOpen` is the bank as it was when the relic interface opened. */
function refusal(player, type, tier, slot, bankOpen) {
  if (type === null) return "notLeague";
  const relic = Common.relic(type, tier, slot);
  if (!relic) return "noSuchRelic";
  if (Common.chosen(player)[tier] !== undefined) return "alreadyChosen";
  if (Common.points(player) < Common.catalog(type).tiers[tier].cost) return "notEnoughPoints";
  if (relic.requiresBank && grantedItems(relic).length > 0 && !mayReceiveItems(player, type, bankOpen)) return "needsBank";
  if (!canDeliver(player, relic)) return "noRoom";
  return null;
}

/** Delivers the plan `canDeliver` approved: each item to the inventory, else to the bank tab that holds or has room for it. */
function grant(player, relic) {
  for (const { item, tab } of deliveryPlan(player, relic) ?? []) {
    if (tab < 0) player.getInventory().add(item, true);
    else player.getBank(tab).add(item, true);
  }
}

/**
 * What a cache-read league says after an unlock, as captured (237/01098): "Congratulations, you've
 * unlocked a new Relic: ..." and, for each item it gave, the item box "You receive an Evil eye.".
 */
function announce(player, type, relic) {
  const own = Common.cacheLeague(type)?.messages;
  if (!own?.unlocked) return;
  player.sendMessage(Common.message("unlocked", { relic: relic.name }, type));
  const { ItemStatementDialogue, DialogueChainBuilder, ItemDefinition } = Common.core;
  const items = grantedItems(relic);
  if (items.length === 0 || !ItemStatementDialogue || !DialogueChainBuilder) return;
  const chain = new DialogueChainBuilder();
  items.forEach((id, index) => {
    const name = ItemDefinition.forId(id)?.getName?.() ?? "";
    const item = `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
    chain.add(new ItemStatementDialogue(index, id, Common.message("received", { item }, type)));
  });
  player.getDialogueManager?.()?.startDialogues?.(chain);
}

/**
 * Reloaded just chosen (rec 1135): after the congratulations, "You can now pick another relic below
 * tier seven!" and the repick varbits of the tiers its extra pick may come from set to 1.
 */
function offerRepick(player, type, tier) {
  player.sendMessage(Common.message("reloadedRepick", { tier: tier + 1 }, type));
  sendRepick(player, type, true);
}

/**
 * The captured unlock: the selection varbit (the tier's, or for Reloaded's extra pick the tier's
 * selection_other, rec 1135) set to the slot, the animation, the league's graphic, the modal
 * closed, four sounds.
 */
function present(player, type, varbit, slot) {
  const { Animation, Graphic } = Common.core;
  const { interface: ui } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbit, slot);
  player.performAnimation(new Animation(ui.unlockAnimation));
  player.performGraphic(new Graphic(Common.league(type).unlockSpotanim, 0, ui.unlockGraphicHeight));
  sender.sendInterfaceRemoval();
  for (const [sound, delay] of ui.unlockSounds) sender.sendSound(sound, 1, delay);
}

/**
 * Chooses relic `slot` (1-3) of `tier` (0-7) for the player, or tells them why not.
 * `bankOpen` is the bank as it was when the relic interface opened (the modal replaces it);
 * callers with no interface pass nothing and the bank as it is now counts.
 * Returns true when the relic was unlocked.
 */
/**
 * Reloaded's extra pick (Raging Echoes' tier 4, Wiki): with Reloaded chosen, one more relic of
 * tiers 1-3, a different one from the tier's own pick, through the same click. Null when this
 * click is not one, else the refusal's message key or "" when it may go ahead.
 */
function reloadedRefusal(player, type, tier, slot, bankOpen) {
  const effect = Common.data.effects.reloaded;
  const picks = Common.chosen(player);
  if (picks[tier] === undefined || !holdsReloaded(type, picks)) return null;
  if (!Common.reloadedTiers(effect, type).includes(tier) || player.getAttribute(Common.RELOADED_ATTRIBUTE)) return null;
  const relic = Common.relic(type, tier, slot);
  if (!relic) return "noSuchRelic";
  if (picks[tier] === slot) return "alreadyChosen";
  if (relic.requiresBank && grantedItems(relic).length > 0 && !mayReceiveItems(player, type, bankOpen)) return "needsBank";
  if (!canDeliver(player, relic)) return "noRoom";
  return "";
}

function unlock(player, tier, slot, { bankOpen = Common.core.Bank.isOpen(player) } = {}) {
  const type = Common.leagueOf(player);
  const reloaded = reloadedRefusal(player, type, tier, slot, bankOpen);
  if (reloaded !== null) {
    if (reloaded) {
      player.sendMessage(Common.message(reloaded, {}, type));
      return false;
    }
    // Live (rec 1135): the tier's selection_other set to the slot, the usual congratulations, the
    // repick varbits cleared; the tier's own pick stays as it is.
    const extra = Common.relic(type, tier, slot);
    player.setAttribute(Common.RELOADED_ATTRIBUTE, { tier, slot });
    present(player, type, Common.data.selectionOtherVarbits[tier], slot);
    grant(player, extra);
    announce(player, type, extra);
    sendRepick(player, type, false);
    Common.api.emitCustomEvent("league:relic-unlocked", { player, league: type, tier, slot, relic: extra.key, reloaded: true });
    return true;
  }
  const why = refusal(player, type, tier, slot, bankOpen);
  if (why) {
    player.sendMessage(Common.message(why, {}, type));
    return false;
  }
  const relic = Common.relic(type, tier, slot);
  player.setAttribute(Common.RELICS_ATTRIBUTE, { ...Common.chosen(player), [tier]: slot });
  present(player, type, Common.data.selectionVarbits[tier], slot);
  grant(player, relic);
  announce(player, type, relic);
  if (relic.key === Common.data.effects.reloaded?.key && holdsReloaded(type, Common.chosen(player))) offerRepick(player, type, tier);
  Common.api.emitCustomEvent("league:relic-unlocked", { player, league: type, tier, slot, relic: relic.key });
  return true;
}

/** Points crossing a tier's cost show the popup once, for each tier still open (capture 227/00070). */
function pointsChanged({ player, points, previous }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const picks = Common.chosen(player);
  const popup = Common.data.notifications.relicAvailable;
  Common.catalog(type).tiers.forEach((tier, tierIndex) => {
    if (picks[tierIndex] !== undefined || tier.cost <= previous || tier.cost > points) return;
    Common.api.emitCustomEvent("notification:show", {
      player,
      title: popup.title,
      text: popup.text.replace("{tier}", String(tierIndex + 1)),
      colour: popup.colour,
      jingle: popup.jingle,
    });
  });
}

function login({ player }) {
  sendSelections(player);
}

/** `league:highest-tier` { player } -> tier: the highest tier index chosen (LeagueMode's XP rate reads it). */
function answerHighestTier(query) {
  if (!query?.player || Common.leagueOf(query.player) === null) return;
  query.tier = Common.highestTier(query.player);
}

/** `league:has-relic` { player, relic: key } -> active: the character's league has that relic and chose it. */
function answerHasRelic(query) {
  if (!query) return;
  query.active = query.player ? Common.hasRelic(query.player, query.relic) : false;
}

/** `league:relics` { player } -> league, chosen (tier index -> slot). */
function answerRelics(query) {
  if (!query) return;
  const type = query.player ? Common.leagueOf(query.player) : null;
  query.league = type;
  query.chosen = type === null ? {} : { ...Common.chosen(query.player) };
  // Reloaded's extra pick, { tier, slot }, while it counts.
  query.extra = type !== null && Common.reloadedPick(query.player) ? { ...query.player.getAttribute(Common.RELOADED_ATTRIBUTE) } : null;
}

/**
 * Developer (`::relic reset`): no relics, Reloaded's extra pick forgotten, the selection varbits
 * cleared, and `league:relics-reset` { player, league } for the effects that keep state (Abundance's
 * boost). The relics' items stay where they are.
 */
function reset(player) {
  player.setAttribute(Common.RELICS_ATTRIBUTE, {});
  player.setAttribute(Common.RELOADED_ATTRIBUTE, null);
  sendSelections(player);
  Common.api.emitCustomEvent("league:relics-reset", { player, league: Common.leagueOf(player) });
}

module.exports = function attach(api) {
  api.persistAttribute(Common.RELICS_ATTRIBUTE, {});
  api.persistAttribute(Common.RELOADED_ATTRIBUTE, null);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:points-changed", pointsChanged);
  api.onCustomEvent("league:highest-tier", answerHighestTier);
  api.onCustomEvent("league:has-relic", answerHasRelic);
  api.onCustomEvent("league:relics", answerRelics);
};

module.exports.unlock = unlock;
module.exports.reset = reset;
module.exports.refusal = refusal;
module.exports.reloadedRefusal = reloadedRefusal;
module.exports.uid = uid;
module.exports.grantedItems = grantedItems;

/**
 * Friendly Forager (https://oldschool.runescape.wiki/w/Friendly_Forager_(Raging_Echoes_League)),
 * Raging Echoes' tier 2 relic: the Forager's pouch, carried or worn, finds a grimy herb (one the
 * player could clean at their Herblore level + 25, of a kind it has room for, 30 of each, 100 in
 * Demonic Pacts) when
 * they gather with Woodcutting, Fishing, Mining or Hunter, at most once every 9 ticks, with the
 * herb's cleaning XP (ours: the Wiki says "a small amount"). Its Check, Fill, Withdraw (a menu:
 * Empty Pouch, or one herb, as notes) and the bank's Empty manage the herbs with the herb sack's
 * lines; it keeps them itself (live shares them with the herb sack).
 * In Herblore, a secondary ingredient has a 90% chance not to be used and a potion is made with
 * four doses instead of three. Demonic Pacts' pouch (tier 2) also makes every Herblore item at once
 * (the effect's `leagueBatch`).
 */
const Common = require("./Common.LeagueRelics");

/** The herbs a pouch holds: item meta { grimyId: count }. */
const POUCH_STORE_META = "league:forager-pouch";

let api;
let core;
let effect;
let alsoSaved;
let neverSaved;

/** The bank side panel's op the cache labels Empty. */
const BANK_EMPTY_OP = 9;

/** When each player's pouch may find its next herb (a process cycle). */
const nextFind = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function pouchId() {
  return core.ItemIdentifiers[effect.tool];
}

/** The pouch the player carries or wears, or null. */
function pouchOf(player) {
  const id = pouchId();
  const worn = player.getEquipment().getItems().find((item) => item?.getId() === id);
  return worn ?? player.getInventory().getItems().find((item) => item?.getId() === id) ?? null;
}

/** The pouch an option was clicked on (its slot), else the one carried or worn. */
function clicked(event) {
  const item = event.item ?? event.player.getInventory().getItems()[event.slot];
  return item?.getId?.() === pouchId() ? item : pouchOf(event.player);
}

function stored(pouch) {
  const value = pouch.getMetaValue?.(POUCH_STORE_META);
  return value && typeof value === "object" ? { ...value } : {};
}

function herbs() {
  const request = { herbs: [] };
  api.emitCustomEvent("herblore:herbs", request);
  return request.herbs;
}

function herbName(itemId) {
  return core.ItemDefinition.forId(itemId)?.getName?.() ?? "Herbs";
}

/** How many of each herb the player's pouch holds: the league's own (Demonic Pacts' 100), else 30. */
function herbCap(player) {
  return effect.leagueHerbCap?.[Common.leagueOf(player)] ?? effect.herbCap;
}

let herbOrder = null;

/** The herbs the pouch holds, in its order: [{ id, label }]. */
function pouchHerbs() {
  herbOrder ??= effect.herbs.map(([gameval, label]) => ({ id: core.CacheDefinitions.getObjId(gameval), label })).filter((herb) => Number.isInteger(herb.id));
  return herbOrder;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage?.(core.ChatType.SPAM, text);
}

/**
 * A gathering action: a herb the pouch has room for and the player could clean at level + 25. With
 * every such herb full, the pouch says so instead, on the same cooldown. A minigame's reward (a
 * `source`, the rumour sack) is not gathering.
 */
function find({ player, source, method }) {
  if (source || method === "rumour-sack" || !player?.isPlayer?.() || !active(player)) return;
  const pouch = pouchOf(player);
  if (!pouch) return;
  const cycle = core.World.getProcessCycle();
  if (cycle < (nextFind.get(player) ?? 0)) return;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) + effect.levelRange;
  const contents = stored(pouch);
  const cleanable = herbs().filter((herb) => herb.level <= level);
  const candidates = cleanable.filter((herb) => (contents[herb.grimyId] ?? 0) < herbCap(player));
  if (candidates.length === 0) {
    if (cleanable.length === 0) return;
    nextFind.set(player, cycle + effect.cooldownTicks);
    spam(player, Common.message("foragerFoundNoRoom"));
    return;
  }
  const herb = candidates[Math.floor(Math.random() * candidates.length)];
  contents[herb.grimyId] = (contents[herb.grimyId] ?? 0) + 1;
  pouch.setMetaValue(POUCH_STORE_META, contents);
  nextFind.set(player, cycle + effect.cooldownTicks);
  if (herb.xp > 0) player.getSkillManager().addExperiences(core.Skill.HERBLORE, herb.xp);
  spam(player, Common.message("foragerFound"));
}

/** The header, then each herb it holds in the pouch's order; an empty pouch answers with the herb sack's line. */
function check(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const contents = stored(pouch);
  const held = pouchHerbs().filter((herb) => (contents[herb.id] ?? 0) > 0);
  player.sendMessage(Common.message("foragerHolds"));
  if (held.length === 0) player.sendMessage(Common.message("foragerEmpty"));
  for (const herb of held) player.sendMessage(Common.message("foragerHoldsHerb", { amount: contents[herb.id], herb: herbName(herb.id) }));
}

/** Every grimy herb in the inventory the pouch holds and has room for goes in, with the herb sack's lines. */
function fill(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const inventory = player.getInventory();
  const carried = pouchHerbs().filter((herb) => inventory.getAmount(herb.id) > 0);
  if (carried.length === 0) {
    player.sendMessage(Common.message("foragerNothingToFill"));
    return;
  }
  spam(player, Common.message("foragerSearch"));
  const contents = stored(pouch);
  let moved = 0;
  for (const { id } of carried) {
    const amount = Math.min(herbCap(player) - (contents[id] ?? 0), inventory.getAmount(id));
    if (amount <= 0) continue;
    inventory.deleteNumber(id, amount);
    contents[id] = (contents[id] ?? 0) + amount;
    moved += amount;
  }
  pouch.setMetaValue(POUCH_STORE_META, contents);
  if (moved > 0) spam(player, Common.message("foragerFilled"));
  else player.sendMessage(Common.message("foragerFillNoRoom"));
}

/** Up to `wanted` of one herb comes out as notes: how many, or -1 when the inventory has no room for them. */
function takeOut(player, pouch, id, wanted) {
  const contents = stored(pouch);
  const amount = Math.min(wanted, contents[id] ?? 0);
  if (amount <= 0) return 0;
  const note = Common.noted(id);
  if (player.getInventory().getAddableAmount(new core.Item(note, amount)) < amount) return -1;
  player.getInventory().adds(note, amount);
  contents[id] -= amount;
  if (contents[id] <= 0) delete contents[id];
  pouch.setMetaValue(POUCH_STORE_META, contents);
  return amount;
}

/** Empty Pouch: every herb comes out as notes. */
function emptyPouch(player, pouch) {
  const contents = stored(pouch);
  const held = pouchHerbs().filter((herb) => (contents[herb.id] ?? 0) > 0);
  if (held.length === 0) {
    player.sendMessage(Common.message("foragerEmpty"));
    return;
  }
  spam(player, Common.message("foragerRummage"));
  for (const herb of held) {
    if (takeOut(player, pouch, herb.id, contents[herb.id]) < 0) {
      player.sendMessage(Common.message("foragerNoRoom"));
      break;
    }
  }
  player.getInventory().refreshItems();
}

/** One herb: how many (a count dialog), then that many as notes, at most what the pouch holds. */
function askAmount(player, herb) {
  player.setEnteredAmountAction({
    execute: (entered) => {
      // The pouch carried or worn when the amount comes in.
      const pouch = pouchOf(player);
      if (!Number.isFinite(entered) || entered <= 0 || !pouch) return;
      const name = herbName(herb.id);
      const taken = takeOut(player, pouch, herb.id, Math.floor(entered));
      if (taken === 0) player.sendMessage(Common.message("foragerNoneOf", { herb: name }));
      else if (taken < 0) player.sendMessage(Common.message("foragerNoRoom"));
      else {
        player.getInventory().refreshItems();
        player.sendMessage(Common.message("foragerWithdrew", { amount: taken, herb: name }));
      }
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(Common.message("foragerHowMany"));
}

const MENU = 187;
const MENU_CHOICES = 3;
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_MENU = 217;
const SCRIPT_RESTORE_INPUT = 2158;
const PAUSE_BUTTON = 1;
const MENU_SLOTS = 127;
/** The herbs each player's open Withdraw menu lists. */
const menus = new WeakMap();

/** Withdraw: the "Withdraw Herb" menu: Empty Pouch, every herb with its count (0 included), Exit. */
function withdraw(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const contents = stored(pouch);
  const herbList = pouchHerbs();
  const labels = [
    Common.message("foragerMenuEmpty"),
    ...herbList.map((herb) => Common.message("foragerMenuHerb", { herb: herb.label, amount: contents[herb.id] ?? 0 })),
    Common.message("foragerMenuExit"),
  ];
  menus.set(player, { herbs: herbList });
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(MENU);
  sender.sendSubInterface(MAIN_MODAL, MENU, 0);
  sender.sendClientScript(SCRIPT_MENU, Common.message("foragerMenuTitle"), labels.join(" | "), 1);
  sender.sendInterfaceFlagsRange((MENU << 16) | MENU_CHOICES, 0, MENU_SLOTS, PAUSE_BUTTON);
}

function closeMenu(player) {
  menus.delete(player);
  const sender = player.getPacketSender();
  sender.closeSubInterface(MAIN_MODAL);
  sender.sendInterfaceScript(SCRIPT_RESTORE_INPUT);
  player.setInterfaceId(-1);
}

function chooseMenu(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== MENU || (event.childId ?? (buttonId & 0xffff)) !== MENU_CHOICES) return;
  const { player } = event;
  const menu = menus.get(player);
  if (!menu) return;
  event.handled = true;
  closeMenu(player);
  // The pouch still carried or worn.
  const pouch = pouchOf(player);
  if (!pouch) return;
  const index = Number(event.action);
  if (index === 0) emptyPouch(player, pouch);
  else if (index >= 1 && index <= menu.herbs.length) askAmount(player, menu.herbs[index - 1]);
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId !== MENU || !menus.has(player)) return;
  menus.delete(player);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
}

/** The bank's Empty (side panel op 9): every herb goes into the bank, unnoted and silently, as far as it has room. */
function bankEmpty(event) {
  if (event.handled || event.op !== BANK_EMPTY_OP || event.item?.getId?.() !== pouchId()) return;
  const { player } = event;
  if (!core.Bank.isOpen(player)) return;
  event.handled = true;
  const pouch = event.item;
  const contents = stored(pouch);
  const held = pouchHerbs().filter((herb) => (contents[herb.id] ?? 0) > 0);
  if (held.length === 0) {
    player.sendMessage(Common.message("foragerEmpty"));
    return;
  }
  for (const { id } of held) {
    const bank = player.getBank(core.Bank.getTabForItem(player, id));
    const item = new core.Item(id, contents[id]);
    const amount = bank.getAddableAmount(item);
    if (amount <= 0) continue;
    bank.add(item.setAmount(amount), false);
    contents[id] -= amount;
    if (contents[id] <= 0) delete contents[id];
  }
  pouch.setMetaValue(POUCH_STORE_META, contents);
  player.getBank(player.getCurrentBankTab()).refreshItems();
  player.getInventory().refreshItems();
}

function gamevals(names) {
  return new Set(names.map((name) => core.CacheDefinitions.getObjId(name)).filter(Number.isInteger));
}

/**
 * The 4-dose form of a 3-dose product, for each of the recipes' naming forms (`3dose…`,
 * `…_3`, `…3`), checked by the item's own name: "Compost potion(3)" -> "Compost potion(4)".
 */
function fourDoseOf(product) {
  if (typeof product !== "string") return null;
  const productId = core.CacheDefinitions.getObjId(product);
  const name = core.ItemDefinition.forId(productId)?.getName?.() ?? "";
  if (!/\(3\)$/.test(name)) return null;
  const wanted = name.replace(/\(3\)$/, "(4)");
  const candidates = [
    product.startsWith("3dose") ? `4dose${product.slice(5)}` : null,
    /_3$/.test(product) ? product.replace(/_3$/, "_4") : null,
    /3$/.test(product) ? product.replace(/3$/, "4") : null,
  ];
  for (const candidate of candidates) {
    const id = candidate && core.CacheDefinitions.getObjId(candidate);
    if (Number.isInteger(id) && core.ItemDefinition.forId(id)?.getName?.() === wanted) return id;
  }
  return null;
}

/**
 * A secondary ingredient is kept 90% of the time: one after the recipe's first (its primary, the
 * potion being made: a haemostatic poultice, an unfinished potion) that is not a potion or a vial,
 * or the Wiki's torstol potion (unf) in an upgrade; a 3-dose potion comes as a 4-dose one.
 */
function mix(request) {
  if (!active(request.player)) return;
  if (!alsoSaved) {
    alsoSaved = gamevals(effect.alsoSaved);
    neverSaved = gamevals(effect.neverSaved);
  }
  const name = (id) => core.ItemDefinition.forId(id)?.getName?.() ?? "";
  const unfinished = /\(unf\)$/i.test(name(request.productId));
  if (!unfinished) {
    request.consume.forEach((item, index) => {
      // Already kept by another listener (Prescription goggles): no second roll, and no second vial back.
      if (item.count <= 0) return;
      const secondary = index > 0 && (alsoSaved.has(item.id) || !Common.isPotion(item.id));
      if (!secondary || neverSaved.has(item.id) || Math.random() >= effect.secondarySaveChance) return;
      item.count = 0;
      // A kept ingredient that came in a vial (the torstol potion (unf)) keeps its vial too.
      if (Common.isPotion(item.id)) {
        const vial = request.returns?.find((returned) => returned.count > 0 && /^vial$/i.test(name(returned.id)));
        if (vial) vial.count--;
      }
    });
  }
  // Brewed with 4 doses, not 3: only a potion brewed from an unfinished one, not an upgrade of a dosed potion.
  const upgrade = request.consume.some((item) => /\(\d\)$/.test(name(item.id)));
  const fourDose = upgrade ? null : fourDoseOf(request.recipe?.product);
  if (!Number.isInteger(fourDose)) return;
  request.productId = fourDose;
  // The dose is the relic's: an amulet of chemistry that answered first spends no charge on it.
  request.extraDose = false;
}

/** A league's batch (`leagueBatch`, Demonic Pacts' Herblore all at once), as the production relics answer. */
function allAtOnce(request) {
  if (!active(request.player)) return;
  const batch = effect.leagueBatch?.[Common.leagueOf(request.player)];
  const actions = batch ? Common.batchActions(batch, request) : null;
  if (actions) request.actions = Math.max(request.actions, actions);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.friendlyForager;
  for (const name of effect.triggers) api.onCustomEvent(name, find);
  api.onItemAction(effect.toolName, { Check: check, Fill: fill, Withdraw: withdraw });
  api.onInterfaceActionClick(chooseMenu);
  api.onCustomEvent("interface:closed", menuClosed);
  api.onCustomEvent(core.Bank.INVENTORY_OP_EVENT, bankEmpty);
  api.onCustomEvent("herblore:mix", mix);
  api.onCustomEvent("skills:actions-per-cycle", allAtOnce);
};

module.exports.POUCH_STORE_META = POUCH_STORE_META;

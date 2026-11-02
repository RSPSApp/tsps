/**
 * Friendly Forager (https://oldschool.runescape.wiki/w/Friendly_Forager_(Raging_Echoes_League)),
 * Raging Echoes' tier 2 relic: the Forager's pouch, carried or worn, finds a grimy herb (one the
 * player could clean at their Herblore level + 25, of a kind it has room for, 30 of each, 100 in
 * Demonic Pacts) when
 * they gather with Woodcutting, Fishing, Mining or Hunter, at most once every 9 ticks, with the
 * herb's cleaning XP (ours: the Wiki says "a small amount"). Its Check, Fill and Withdraw (as
 * notes) options manage the herbs, which it keeps itself (live shares them with the herb sack).
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

/** A gathering action: a herb the pouch has room for and the player could clean at level + 25. A minigame's reward (a `source`, the rumour sack) is not gathering. */
function find({ player, source, method }) {
  if (source || method === "rumour-sack" || !player?.isPlayer?.() || !active(player)) return;
  const pouch = pouchOf(player);
  if (!pouch) return;
  const cycle = core.World.getProcessCycle();
  if (cycle < (nextFind.get(player) ?? 0)) return;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) + effect.levelRange;
  const contents = stored(pouch);
  const candidates = herbs().filter((herb) => herb.level <= level && (contents[herb.grimyId] ?? 0) < herbCap(player));
  if (candidates.length === 0) return;
  const herb = candidates[Math.floor(Math.random() * candidates.length)];
  contents[herb.grimyId] = (contents[herb.grimyId] ?? 0) + 1;
  pouch.setMetaValue(POUCH_STORE_META, contents);
  nextFind.set(player, cycle + effect.cooldownTicks);
  if (herb.xp > 0) player.getSkillManager().addExperiences(core.Skill.HERBLORE, herb.xp);
  player.getPacketSender().sendTypedMessage?.(core.ChatType.SPAM, Common.message("foragerFound"));
}

function check(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const contents = Object.entries(stored(pouch)).filter(([, amount]) => amount > 0);
  if (contents.length === 0) {
    player.sendMessage(Common.message("foragerEmpty"));
    return;
  }
  player.sendMessage(Common.message("foragerHolds"));
  for (const [id, amount] of contents) player.sendMessage(Common.message("foragerHoldsHerb", { amount, herb: herbName(Number(id)) }));
}

/** Every grimy herb in the inventory the pouch knows and has room for goes in. */
function fill(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const known = new Set(herbs().map((herb) => herb.grimyId));
  const contents = stored(pouch);
  const inventory = player.getInventory();
  let moved = 0;
  for (const id of known) {
    const room = herbCap(player) - (contents[id] ?? 0);
    const amount = Math.min(room, inventory.getAmount(id));
    if (amount <= 0) continue;
    inventory.deleteNumber(id, amount);
    contents[id] = (contents[id] ?? 0) + amount;
    moved += amount;
  }
  pouch.setMetaValue(POUCH_STORE_META, contents);
  player.sendMessage(moved > 0 ? Common.message("foragerFilled", { amount: moved }) : Common.message("foragerNothingToFill"));
}

/** Every herb comes out as notes (Wiki), while the inventory has room for the stacks. */
function withdraw(event) {
  const { player } = event;
  const pouch = clicked(event);
  if (!pouch) return;
  const contents = stored(pouch);
  const inventory = player.getInventory();
  for (const [id, amount] of Object.entries(contents)) {
    if (amount <= 0) continue;
    const note = Common.noted(Number(id));
    if (inventory.getAddableAmount(new core.Item(note, amount)) < amount) {
      player.sendMessage(Common.message("foragerNoRoom"));
      break;
    }
    inventory.adds(note, amount);
    delete contents[id];
  }
  pouch.setMetaValue(POUCH_STORE_META, contents);
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
  if (Number.isInteger(fourDose)) request.productId = fourDose;
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
  api.onCustomEvent("herblore:mix", mix);
  api.onCustomEvent("skills:actions-per-cycle", allAtOnce);
};

module.exports.POUCH_STORE_META = POUCH_STORE_META;

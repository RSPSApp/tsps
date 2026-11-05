/**
 * The Nomad's reward shop, interface 442, as recorded (rsprox 227/00079, 00076; soul-wars.json
 * `rewards`):
 * - the Nomad's Trade opens it (the generic shop bound to him from shops.json gives way);
 * - the cache draws the three tabs (experience, imbues, other) from varp soul_wars_zeal_tokens and
 *   the inventory; picking an entry is client-side, and only the confirm button's sub (the entry's
 *   index) and the quantity choices reach the server, which checks everything again;
 * - experience: 1, 10, 100 or X tokens of a skill at floor(L*L/600) * 30, 27 or 14 a token, from
 *   level 30 (script 575);
 * - imbues: the item is swapped in place for its imbued form (enums 3541-3545);
 * - other: the Soul cape (Prayer 70), the Ectoplasmator (Prayer 40), Spoils of War and the blighted
 *   supplies, one at a time or X ("How many would you like to buy? (1-N)").
 * His Trade option shows once the player has seen his demonstration (varbit
 * soul_wars_finished_tutorial; Tutorial.SoulWars).
 */
const Common = require("./Common.SoulWars");

const SHOP_ID = 1464;
const NOMAD_ROOT = 10555;
const NOMAD_SPAWNED = 10528;
const OP1 = 1 << 1;
const OP5 = 1 << 5;
const COMPONENTS = [
  "xp_rewards", "imbue_rewards", "other_rewards", "confirm_xp", "button_xp", "confirm_imbue", "button_imbue",
  "confirm_other", "button_other", "total_zeal", "total_zeal_tokens", "imbue_scrollbar", "other_scrollbar",
];
/** Per entry, as the cache lays the lists out: 6 children a skill row, 5 an "other" entry. */
const XP_CHILDREN = 6;
const XP_TOKEN_CHILDREN = { 2: 0, 3: 1, 4: 2, 5: 3 };
const OTHER_CHILDREN = 5;
const OTHER_ONE = new Set([1, 3]);
const OTHER_X = 4;

/** What each player has chosen that the client doesn't send with the confirm: X amounts. */
const choices = new WeakMap();
let nomadFound = false;

const rewards = () => Common.data.rewards;
const enumOf = (name) => Common.core.CacheDefinitions.getEnumValues(rewards().enums[name]);
const uid = (name) => Common.component(`${rewards().interface}:${name}`);
const tokens = (player) => Common.getVarp(player, "zeal_tokens");
const message = (name, values = {}) =>
  String(rewards().messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));

function choiceOf(player) {
  let choice = choices.get(player);
  if (!choice) {
    choice = { xpTokens: 0, quantity: 1 };
    choices.set(player, choice);
  }
  return choice;
}

function synth(player, name) {
  player.getPacketSender().sendSound?.(rewards().synths[name], 100, 0);
}

/** A refusal the client can't foresee (no room, the item gone): said, with the refusal sound. */
function refuse(player, line) {
  player.sendMessage(line);
  synth(player, "refused");
  return true;
}

/**
 * A refusal the client already gave (script 846: its line and sound, then the click is sent
 * anyway): nothing more is said.
 */
const clientRefused = () => true;

function open(player) {
  const sender = player.getPacketSender();
  const { openScript, modalScript, interface: name } = rewards();
  sender.sendInterfaceRemoval?.();
  sender.sendConfig(Common.varpId("soul_wars_zeal"), Common.getVarp(player, "zeal"));
  sender.sendConfig(Common.varpId("soul_wars_zeal_tokens"), tokens(player));
  sender.sendInterfaceScript(modalScript, [-1, -1]);
  sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.core.CacheDefinitions.getInterfaceId(name), 0);
  sender.sendInterfaceScript(openScript, [0, ...COMPONENTS.map(uid)]);
  sender.sendInterfaceFlagsRange(uid("xp_rewards"), 0, 162, OP1);
  sender.sendInterfaceFlagsRange(uid("confirm_xp"), 0, 27, OP1);
  sender.sendInterfaceFlagsRange(uid("confirm_imbue"), 0, enumOf("imbueCost").size - 1, OP1);
  sender.sendInterfaceFlagsRange(uid("confirm_other"), 0, 12, OP1);
  sender.sendInterfaceFlagsRange(uid("other_rewards"), 0, 64, OP1 | OP5);
  choiceOf(player).quantity = 1;
}

/** The generic shop bound to the Nomad gives way to the recorded one. */
function canShop(event) {
  if (event.shopId !== SHOP_ID || !event.player) return;
  open(event.player);
  event.allow = false;
}

function amountPrompt(player, text, max, done) {
  player.setEnteredAmountAction?.({ execute: (amount) => done(Math.min(max, Math.max(0, Math.floor(Number(amount) || 0)))) });
  player.getPacketSender().sendEnterAmountPrompt(text);
}

// ---------------------------------------------------------------- experience

function xpPerToken(player, row) {
  const [skill, multiplier] = rewards().xpRows[row];
  const level = Common.maxLevel(player, skill);
  return level < rewards().xpMinLevel ? 0 : Math.floor((level * level) / 600) * multiplier;
}

/** A list click: only X needs the server (the amount). */
function xpList({ player, slot }) {
  const column = XP_TOKEN_CHILDREN[slot % XP_CHILDREN];
  if (column !== 3) return true;
  const have = tokens(player);
  if (have < 1) return clientRefused();
  amountPrompt(player, message("howManyTokens", { max: have }), have, (amount) => {
    choiceOf(player).xpTokens = amount;
    player.getPacketSender().sendConfig(rewards().xpAmountVarp, amount);
  });
  return true;
}

function buyXp({ player, slot }) {
  const row = Math.floor(slot / 4);
  if (row < 0 || row >= rewards().xpRows.length) return true;
  const cost = slot % 4 === 3 ? choiceOf(player).xpTokens : enumOf("xpTokens").get(slot);
  if (!(cost > 0)) return true;
  const per = xpPerToken(player, row);
  if (per <= 0 || tokens(player) < cost) return clientRefused();
  const [skill] = rewards().xpRows[row];
  Common.addVarp(player, "zeal_tokens", -cost);
  const xp = per * cost;
  player.getSkillManager().addExperience(Common.core.Skill[skill], xp, false);
  const name = skill.charAt(0) + skill.slice(1).toLowerCase();
  player.sendMessage(message("xp", { xp: xp.toLocaleString("en-GB"), skill: name }));
  synth(player, "bought");
  return true;
}

// ---------------------------------------------------------------- imbues

function imbue({ player, slot }) {
  const imbued = enumOf("imbueItem").get(slot);
  const cost = enumOf("imbueCost").get(slot);
  const base = imbued == null ? null : enumOf("imbueBase").get(imbued);
  if (base == null || cost == null) return true;
  const inventory = player.getInventory();
  const items = inventory.getItems();
  const at = items.findIndex((item) => item?.getId?.() === base);
  if (at < 0) return refuse(player, message("noItem"));
  if (tokens(player) < cost) return clientRefused();
  Common.addVarp(player, "zeal_tokens", -cost);
  // The item keeps what it carries (a ring of suffering's charges, a preset's restriction).
  const meta = items[at].getMeta?.();
  inventory.setItem(at, new Common.core.Item(imbued, 1, meta ? { ...meta } : null));
  inventory.refreshItems?.();
  player.sendMessage(message("imbued", { name: Common.core.CacheDefinitions.getItem(base)?.name ?? "item" }));
  synth(player, "imbued");
  return true;
}

// ---------------------------------------------------------------- other rewards

function otherList({ player, slot, opId }) {
  const index = Math.floor(slot / OTHER_CHILDREN);
  const child = slot % OTHER_CHILDREN;
  const item = enumOf("otherItem").get(index);
  const cost = enumOf("otherCost").get(index);
  if (item == null || cost == null) return true;
  if (opId === 5) {
    player.sendMessage(Common.core.ItemDefinition.forId(item)?.getExamine?.() ?? Common.core.CacheDefinitions.getItem(item)?.name ?? "");
    return true;
  }
  const choice = choiceOf(player);
  if (OTHER_ONE.has(child)) {
    choice.quantity = 1;
    return true;
  }
  if (child !== OTHER_X) return true;
  const max = Math.floor(tokens(player) / cost);
  if (max < 1) return clientRefused();
  amountPrompt(player, message("howMany", { max }), max, (amount) => {
    choice.quantity = amount;
    player.getPacketSender().sendConfig(rewards().quantityVarp, amount);
  });
  return true;
}

/** "Spoils of War" reads "Spoils of war" in the recorded line. */
function lineName(name) {
  return name.charAt(0) + name.slice(1).toLowerCase();
}

function buyOther({ player, slot }) {
  const item = enumOf("otherItem").get(slot);
  const each = enumOf("otherCost").get(slot);
  if (item == null || each == null) return true;
  const quantity = choiceOf(player).quantity;
  if (!(quantity > 0)) return true;
  const definition = Common.core.CacheDefinitions.getItem(item);
  const name = definition?.name ?? "item";
  const prayer = rewards().prayerFor[item];
  const cost = quantity * each;
  if ((prayer && Common.maxLevel(player, "PRAYER") < prayer) || tokens(player) < cost) return clientRefused();
  const count = quantity * (enumOf("otherBatch").get(item) ?? 1);
  const inventory = player.getInventory();
  const stackable = Common.core.ItemDefinition.forId(item)?.isStackable?.() === true;
  const room = stackable
    ? (inventory.contains(item) ? inventory.getAddableAmount(new Common.core.Item(item, count)) >= count : inventory.getFreeSlots() > 0)
    : inventory.getFreeSlots() >= count;
  if (!room) return refuse(player, message("noRoom"));
  Common.addVarp(player, "zeal_tokens", -cost);
  const before = inventory.getAmount(item);
  if (stackable) inventory.add(new Common.core.Item(item, count), false);
  else for (let i = 0; i < count; i++) inventory.add(new Common.core.Item(item, 1), false);
  inventory.refreshItems?.();
  const credited = Math.max(0, inventory.getAmount(item) - before);
  if (credited > 0) Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: item, amount: credited });
  player.sendMessage(message("bought", { name: lineName(name), cost }));
  synth(player, "bought");
  choiceOf(player).quantity = 1;
  return true;
}

// ---------------------------------------------------------------- the Nomad

/** The lobby's Nomad takes his transforming form, so each player's tutorial varbit picks his options. */
function findNomad() {
  if (nomadFound) return false;
  const npcs = Common.core.World?.getNpcs?.();
  for (const npc of npcs ?? []) {
    if (npc?.getId?.() !== NOMAD_SPAWNED || !Common.inBox(npc.getLocation(), Common.data.lobby.bounds)) continue;
    npc.setNpcTransformationId?.(NOMAD_ROOT);
    nomadFound = true;
    return false;
  }
  return true;
}

function attachRewards(api) {
  api.onCanShop(canShop);
  api.onInterfaceActionButton(uid("xp_rewards"), xpList);
  api.onInterfaceActionButton(uid("confirm_xp"), buyXp);
  api.onInterfaceActionButton(uid("confirm_imbue"), imbue);
  api.onInterfaceActionButton(uid("other_rewards"), otherList);
  api.onInterfaceActionButton(uid("confirm_other"), buyOther);
  Common.every(findNomad);
}

module.exports = { attachRewards, open, canShop, xpList, buyXp, imbue, otherList, buyOther, xpPerToken, findNomad, SHOP_ID };

// The Desert Quarry's grinder, Sandstorm, and Drew who runs it (rsprox 232/03162 and 232/03165):
// sandstone ground in the grinder becomes buckets of sand Drew sells for 50 coins each, into buckets he
// holds for the player. Both counts are the server's own; live OSRS sends the client no varp for them.
// The quarry's rocks are in skills/Mining.plugin.js.
const DATA = require("./data/desert-quarry.json");

const BUCKETS_ATTRIBUTE = "desert-quarry:buckets";
const SAND_ATTRIBUTE = "desert-quarry:sand";

let api;

const core = () => api.core;
const objId = (name) => core().CacheDefinitions.getObjId(name);
const text = (key, values = {}) => DATA.messages[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
const amount = (value) => Number(value).toLocaleString("en-US");

const buckets = (player) => Number(player.getAttribute(BUCKETS_ATTRIBUTE)) || 0;
const sand = (player) => Number(player.getAttribute(SAND_ATTRIBUTE)) || 0;
const setBuckets = (player, value) => player.setAttribute(BUCKETS_ATTRIBUTE, value);
const setSand = (player, value) => player.setAttribute(SAND_ATTRIBUTE, value);

/** Drew's lines ([mood, text], or ["player:mood", text] for the player's), then `then` if given. */
function talk(player, lines, then = null) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue, EndDialogue } = core();
  const builder = new DialogueChainBuilder();
  const drew = core().CacheDefinitions.getNpcId(DATA.drew);
  let index = 0;
  for (const [mood, line] of lines) {
    if (mood.startsWith("player:")) builder.add(new PlayerDialogue(index++, line, DATA.anim[mood.slice(7)]));
    else builder.add(new NpcDialogue(index++, drew, line, undefined, DATA.anim[mood]));
  }
  // An action only ever ends a chain: anywhere else it stalls the client.
  if (then) builder.add(new ActionDialogue(index, { execute: () => then() }));
  else builder.add(new EndDialogue(index));
  player.getDialogueManager().startDialogues(builder);
}

function choose(player, title, ...options) {
  api.sendMultiChatboxPrompt(player, title, ...options.flatMap(([option, action]) => [option, () => action()]));
}

function askAmount(player, prompt, then) {
  // acceptsZero: Drew has his own line for 0, which the client's amount packet would otherwise drop.
  player.setEnteredAmountAction({ acceptsZero: true, execute: (count) => then(Math.max(0, Math.floor(Number(count) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt(prompt);
}

// ---------------------------------------------------------------- Drew

function menu(player) {
  const m = DATA.messages;
  choose(player, m.select,
    [m.aboutOption, () => talk(player, m.about, () => menu(player))],
    [m.depositOption, () => depositBuckets(player)],
    [m.withdrawOption, () => claimSand(player)],
    [m.checkOption, () => check(player)],
    [m.nothingOption, () => talk(player, [["player:neutral", m.nothing], ["content", m.bye]])]);
}

function talkTo({ player }) {
  talk(player, [["quiz", text("greeting")]], () => menu(player));
}

/** Noted or unnoted empty buckets, up to the 25,000 Drew holds. */
function depositBuckets(player) {
  const inventory = player.getInventory();
  const ids = DATA.buckets.map(objId);
  const held = ids.reduce((sum, id) => sum + inventory.getAmount(id), 0);
  if (held <= 0) return talk(player, [["content", text("noBuckets")]]);
  if (buckets(player) >= DATA.maxBuckets) return talk(player, [["neutral", text("full")]]);
  askAmount(player, text("depositPrompt"), (count) => {
    if (count <= 0) return talk(player, [["content", text("zeroBuckets")]]);
    let left = Math.min(count, DATA.maxBuckets - buckets(player));
    for (const id of ids) {
      const taken = Math.min(left, inventory.getAmount(id));
      if (taken <= 0) continue;
      inventory.deleteNumber(id, taken);
      left -= taken;
      setBuckets(player, buckets(player) + taken);
    }
    inventory.refreshItems();
    talk(player, [holding(buckets(player))]);
  });
}

function holding(count) {
  if (count === 1) return ["neutral", text("holdingOne")];
  if (count >= DATA.manyBuckets) return ["neutral2", text("holdingMany", { buckets: amount(count) })];
  return ["neutral", text("holding", { buckets: amount(count) })];
}

function check(player) {
  const line = ["neutral2", text("check", { buckets: amount(buckets(player)), sand: amount(sand(player)) })];
  if (buckets(player) <= 0 || sand(player) <= 0) return talk(player, [line]);
  talk(player, [line, ["quiz", text("purchase")]], () => choose(player, DATA.messages.select,
    [text("yes"), () => claimSand(player)],
    [text("no"), () => talk(player, [["neutral", text("goodbye")]])]));
}

/**
 * How many of `wanted` noted sand the inventory takes. Only those are paid for, so a stack near its
 * cap (or one with other metadata) never costs buckets, sand or coins that bring nothing. Paying every
 * coin frees the coins' slot, which a full inventory without a sand stack can then use.
 */
function deliverable(inventory, note, wanted, coins) {
  const addable = inventory.getAddableAmount(new (core().Item)(note, wanted));
  if (addable > 0 || coins !== wanted * DATA.sandPrice) return addable;
  return inventory.getAmount(note) > 0 ? 0 : wanted;
}

/** Buckets of sand, noted, 50 coins each: as many as the sand, the buckets and the coins allow. */
function claimSand(player) {
  const inventory = player.getInventory();
  const most = Math.min(buckets(player), sand(player));
  if (most <= 0) return talk(player, [["neutral3", text("nothingToClaim")]]);
  if (inventory.getAmount(DATA.coins) < DATA.sandPrice) return talk(player, [["neutral3", text("poor")]]);
  askAmount(player, text("claimPrompt"), (count) => {
    if (count <= 0) return talk(player, [["angry2", text("zeroSand")]]);
    const note = objId(DATA.sandNote);
    const coins = inventory.getAmount(DATA.coins);
    const wanted = Math.min(count, buckets(player), sand(player), Math.floor(coins / DATA.sandPrice));
    if (wanted <= 0) return talk(player, [["neutral3", text("poor")]]);
    const given = deliverable(inventory, note, wanted, coins);
    if (given <= 0) return talk(player, [["neutral3", text("noRoom")]]);
    inventory.deleteNumber(DATA.coins, given * DATA.sandPrice);
    inventory.add(new (core().Item)(note, given));
    inventory.refreshItems();
    setBuckets(player, buckets(player) - given);
    setSand(player, sand(player) - given);
    talk(player, [["happy2", text("claimed")]]);
  });
}

// ---------------------------------------------------------------- the grinder

/**
 * Every unnoted sandstone in the inventory goes in at once (recorded: no animation, no sound), up to the
 * 25,000 buckets' worth Sandstorm holds (Wiki): pieces that would go over it stay in the inventory.
 */
function grind(player) {
  const inventory = player.getInventory();
  const held = Object.keys(DATA.sandstone).some((name) => inventory.getAmount(objId(name)) > 0);
  if (!held) return void player.sendMessage(text("noSandstone"));
  let ground = 0;
  for (const [name, per] of Object.entries(DATA.sandstone)) {
    const id = objId(name);
    const fits = Math.floor((DATA.maxSand - sand(player) - ground) / per);
    const count = Math.min(inventory.getAmount(id), Math.max(0, fits));
    if (count <= 0) continue;
    inventory.deleteNumber(id, count);
    ground += count * per;
  }
  inventory.refreshItems();
  setSand(player, sand(player) + ground);
  player.sendMessage(text("ground", { sand: amount(sand(player)) }));
}

const isGrinder = (object) => object?.getId?.() === core().CacheDefinitions.getLocId("grinder_machine");

function deposit({ player, object }) {
  if (!isGrinder(object)) return false;
  grind(player);
  return true;
}

const SANDSTONE_IDS = () => new Set(Object.keys(DATA.sandstone).map(objId));

function sandstoneOnGrinder(event) {
  const { player, item, itemId } = event;
  const definition = core().ItemDefinition.forId(itemId);
  const noted = definition?.isNoted?.() === true;
  const baseId = noted ? definition.getNoteId() : itemId;
  if (!SANDSTONE_IDS().has(baseId)) return false;
  event.handled = true;
  if (noted) return void talk(player, [["content2", text("noted")]]);
  grind(player);
  return item != null;
}

// ---------------------------------------------------------------- hooks

/** Only the quarry's Drew (other NPCs may share the name). */
const isDrew = (npc) => npc?.getId?.() === core().CacheDefinitions.getNpcId(DATA.drew);

function drewTalkTo(event) {
  if (!isDrew(event.npc)) return false;
  talkTo(event);
  return true;
}

function drewClaimSand({ player, npc }) {
  if (!isDrew(npc)) return false;
  claimSand(player);
  return true;
}

function drewCheck({ player, npc }) {
  if (!isDrew(npc)) return false;
  check(player);
  return true;
}

function drewDepositBuckets({ player, npc }) {
  if (!isDrew(npc)) return false;
  depositBuckets(player);
  return true;
}

function itemOnGrinder(event) {
  if (event.handled || !isGrinder(event.object)) return;
  sandstoneOnGrinder(event);
}

module.exports = {
  name: "DesertQuarry",
  description: "Desert Quarry's grinder and Drew: ground sandstone becomes buckets of sand that Drew sells for 50 coins each.",
  members: true,
  DATA,
  BUCKETS_ATTRIBUTE,
  SAND_ATTRIBUTE,
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(BUCKETS_ATTRIBUTE, 0);
    api.persistAttribute(SAND_ATTRIBUTE, 0);
    api.onNpcInteraction("Drew", { "Talk-to": drewTalkTo, "Claim Sand": drewClaimSand, Check: drewCheck, "Deposit buckets": drewDepositBuckets });
    api.onObjectInteraction(DATA.grinder, { Deposit: deposit });
    api.onItemOnObject(itemOnGrinder);
  },
};

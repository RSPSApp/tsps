"use strict";

// Permanent reward interactions: owning the toy, not an active holiday window, permits
// using it. The animations, swaps and rank checks live in data/holiday-toys.json with
// their sources; this file only resolves cache names and plays them.
const toys = require("./data/holiday-toys.json");
// Options whose words are Wiki transcripts (Zombie head Question, Eek Talk-to...).
const Dialogue = require("./holidaytoys/Dialogue.HolidayToys");
// PluginManager's worn option convention: worn ops are obj params 451.. from click 2.
const WORN_OPTION_PARAM = 451, FIRST_WORN_OPTION_CLICK = 2;
// Chat type the recording's message_game type=mesbox line uses (as Guests.Clans does).
const MESBOX_CHAT_TYPE = 115;
// Rev 232 recording 3200: a WWF toy clicked every tick replays its sequence each time but
// says "Grrrr!" about every 6 ticks, so overheads have a 6-tick per-player cooldown.
const SAY_COOLDOWN_TICKS = 6;
// Santa's list: the list the first Check put the player on (Wiki: chosen at random then).
const SANTAS_LIST_ATTRIBUTE = "holiday-toys:santas-list";
const LISTS = ["nice", "naughty"];
const lastSay = new WeakMap();
let core;
let actions;

function resolve(name, lookup, what) {
  const id = core.CacheDefinitions[lookup](name);
  if (id == null) throw new Error(`HolidayToys: ${what} ${name} is missing from the active cache`);
  return id;
}

// Built once at startup into a local map, so a missing cache name fails loudly at boot
// rather than leaving a half-built table behind.
function build() {
  if (actions) return actions;
  const built = new Map();
  const add = (itemId, option, action) => built.set(`${itemId}:${option}`, action);
  for (const entry of toys.animations) {
    const action = {
      kind: "animation",
      seq: entry.seq ? resolve(entry.seq, "getSeqId", "sequence") : null,
      spotanim: entry.spotanim ? resolve(entry.spotanim, "getSpotanimId", "spotanim") : null,
      sound: entry.sound ?? null, say: entry.say ?? null, unlocks: entry.unlocks === true,
      unsafe: entry.unsafe ?? null,
    };
    for (const item of entry.items) add(resolve(item, "getObjId", "item"), entry.option, action);
  }
  for (const swap of toys.swaps) {
    const ids = swap.cycle.map(item => resolve(item, "getObjId", "item"));
    ids.forEach((id, index) => add(id, swap.option, { kind: "swap", to: ids[(index + 1) % ids.length] }));
  }
  for (const entry of toys.mapanims) {
    const action = { kind: "mapanim", spotanim: resolve(entry.spotanim, "getSpotanimId", "spotanim"), height: entry.height, delays: entry.delays };
    for (const item of entry.items) add(resolve(item, "getObjId", "item"), entry.option, action);
  }
  for (const chase of toys.chases) {
    const from = resolve(chase.item, "getObjId", "item"), to = resolve(chase.to, "getObjId", "item");
    add(from, chase.option, { kind: "chase", npc: resolve(chase.npc, "getNpcId", "npc"), distance: chase.distance, to });
    add(to, chase.revert, { kind: "swap", to: from });
  }
  const rank = { kind: "rank", varbit: resolve(toys.ranks.varbit, "getVarbitId", "varbit") };
  for (const item of toys.ranks.items) for (const option of toys.ranks.options) add(resolve(item, "getObjId", "item"), option, rank);
  for (const item of toys.santasList.items) add(resolve(item, "getObjId", "item"), toys.santasList.option, { kind: "list" });
  actions = built;
  return actions;
}

function startup() {
  build();
  Dialogue.build();
}

function optionOf(event, worn) {
  if (event.option) return event.option;
  const definition = core.CacheDefinitions.getItem(event.itemId);
  if (!worn) return definition.inventoryActions?.[event.clickType - 1] ?? null;
  const option = definition.params?.get?.(WORN_OPTION_PARAM + event.clickType - FIRST_WORN_OPTION_CLICK);
  return typeof option === "string" ? option : null;
}

function rankTitle(player, action) {
  const hugs = player.getPacketSender().getVarbit(action.varbit);
  let title = toys.ranks.titles[0][1];
  for (const [minimum, name] of toys.ranks.titles) if (hugs >= minimum) title = name;
  return title;
}

function animate(player, action) {
  if (action.seq != null) player.performAnimation(new core.Animation(action.seq));
  if (action.spotanim != null) player.performGraphic(new core.Graphic(action.spotanim));
  if (action.sound != null) player.getPacketSender().sendSound(action.sound, 1, 0);
  if (action.say) {
    const now = Date.now(), gap = SAY_COOLDOWN_TICKS * core.GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
    if (!lastSay.has(player) || now - lastSay.get(player) >= gap) {
      lastSay.set(player, now);
      player.forceChat(action.say);
    }
  }
}

// Rev 223 recording 1375 (Snow): the same spotanim on the player's tile on the click tick and the
// next, each with its own delay, seen by everyone nearby.
function mapAnim(player, action) {
  const tile = player.getLocation().clone();
  const play = delay => player.getPacketSender().sendGlobalGraphic(new core.Graphic(action.spotanim, delay, action.height), tile);
  play(action.delays[0]);
  action.delays.slice(1).forEach((delay, index) => core.TaskManager.submit(new core.CountdownTask(null, index + 1, play.bind(null, delay))));
}

// Wiki (Cat ears): Chase while near Hell-Rats turns them into Hell cat ears. Nothing sources a
// message for chasing with no rat about, so the option then does nothing.
function hellRatNearby(player, action) {
  return core.World.getNpcsNear(player.getLocation(), action.distance, player.getPrivateArea())
    .some(npc => npc.getId() === action.npc && npc.getHitpoints() > 0);
}

function swap(player, container, item, to) {
  item.setId(to);
  container.refreshItems();
  if (container === player.getEquipment()) {
    core.BonusManager.update(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  }
}

/** Wiki (Santa's list): the first Check picks a list at random; later checks repeat it. */
function checkList(player) {
  const list = toys.santasList;
  let name = player.getAttribute(SANTAS_LIST_ATTRIBUTE);
  if (!LISTS.includes(name)) {
    name = LISTS[Math.floor(Math.random() * LISTS.length)];
    player.setAttribute(SANTAS_LIST_ATTRIBUTE, name);
    player.sendMessage(list.first[name]);
    return;
  }
  const lines = list.again[name];
  player.sendMessage(lines[Math.floor(Math.random() * lines.length)]);
}

function useToy(api, event) {
  const { player, item, slot } = event;
  if (!item || !player) return;
  const worn = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  // The native client sends the packed inventory:items component, the legacy one 3214.
  const inventory = event.interfaceId === core.Inventory.INTERFACE_ID ||
    event.interfaceId === core.CacheDefinitions.getComponentId("inventory:items");
  const container = worn ? player.getEquipment() : inventory ? player.getInventory() : null;
  if (!container || container.getItems()[slot] !== item || item.getId() !== event.itemId) return;
  const option = optionOf(event, worn);
  const action = build().get(`${event.itemId}:${option}`) ?? Dialogue.build().get(`${event.itemId}:${option}`);
  if (!action) return;
  event.handled = true;
  if (player.getHitpoints() <= 0 || player.getStatus() !== core.PlayerStatus.NONE || player.isTeleportingReturn()) return;
  if (action.kind === "dialogue") {
    Dialogue.play(player, event.itemId, option, container, item);
    return;
  }
  if (action.kind === "list") {
    checkList(player);
    return;
  }
  if (action.kind === "animation") {
    // Wiki (Giant easter egg): refused in PvP areas with its own line.
    if (action.unsafe && core.Wilderness.levelAt(player.getLocation().getX(), player.getLocation().getY()) > 0) {
      player.sendMessage(action.unsafe);
      return;
    }
    animate(player, action);
    // Rev 232 recording 3200: the first Play-with of a held toy unlocks it at Diango.
    if (action.unlocks) api.emitCustomEvent("holiday-rewards:used", { player, itemId: event.itemId });
  } else if (action.kind === "swap") swap(player, container, item, action.to);
  else if (action.kind === "mapanim") mapAnim(player, action);
  else if (action.kind === "chase") {
    if (hellRatNearby(player, action)) swap(player, container, item, action.to);
  } else {
    // Rev 232 recording 3200: a mesbox chat line, then the message box with a line break.
    const title = rankTitle(player, action);
    player.getPacketSender().sendTypedMessage(MESBOX_CHAT_TYPE, `${toys.ranks.message} <col=6f0000>${title}`);
    const { DialogueChainBuilder, StatementDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new StatementDialogue(0, `${toys.ranks.message}<br><col=6f0000>${title}`)));
  }
}

function lookAtSnowGlobe(api, { player, itemId }) {
  const cache = api.core.CacheDefinitions;
  if (itemId !== cache.getObjId("xmas16_snowglobe")) return false;
  player.getPacketSender().sendInterface(cache.getInterfaceId("xmas16_snow_globe"));
}

module.exports = {
  name: "HolidayToys",
  register(api) {
    core = api.core;
    Dialogue.init(api, swap);
    api.persistAttribute(SANTAS_LIST_ATTRIBUTE, null);
    api.persistAttribute(Dialogue.BOTTLE_TALKS_ATTRIBUTE, 0);
    api.persistAttribute(Dialogue.SANTA_COLOURS_ATTRIBUTE, 0);
    api.onServerStartup(startup);
    api.onItemAction("Snow globe", { "Look at": lookAtSnowGlobe.bind(null, api) });
    api.onItemAction(useToy.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", Dialogue.onAction);
    api.onCustomEvent("npc-dialogue:choice", Dialogue.onChoice);
    api.onNpcDialogueCondition(Dialogue.answerCondition);
    api.onNpcDialogueVariant(Dialogue.deliveryVariant);
  },
};

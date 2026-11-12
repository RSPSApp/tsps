/**
 * The Ranging Guild entrance (https://oldschool.runescape.wiki/w/Ranging_Guild): 40 Ranged to
 * enter, "though this can be boosted", so the visible level is what counts. The doorman turns the
 * rest away with his Wiki transcript's line; leaving is never stopped.
 *
 * The door itself is loc 11665 "Guild door" at 2658,3438: a diagonal (type 9) leaf with an Open
 * action and no open variant in the cache. objects/Doors carries it as a pass-through gate, so the
 * doorway keeps an inviswall while it stands open and the opener is carried across — nothing can
 * walk or follow through it. This plugin only decides who may open it, on the door:toggle event
 * that runs before the gate (the Champions' Guild's shape).
 *
 * The leaf sits in the guild's diagonal north-west fence, so the two sides are the two half-planes
 * either side of x - y through the door tile: the guild is the larger side. That splits the four
 * tiles a player can click it from the way the diagonal does — 2657,3438 and 2658,3439 outside,
 * 2659,3438 and 2658,3437 inside. The half-plane alone runs to the edge of the map, so the guild's
 * own ground floor bounds it (the archery area's rectangle, whose north-west corner the fence cuts).
 */
const REQUIRED_LEVEL = 40;
const REFUSAL_VARIANT = "standard-dialogue-attempting-to-enter-the-ranging-guild-without-40-ranged";
const DOOR = { x: 2658, y: 3438, z: 0 };
const TICKET_EXCHANGE_SHOP_ID = 1461;
const TICKET_EXCHANGE_INTERFACE = 2;
const TICKET_EXCHANGE_ITEMS = require("./data/ranging-guild-ticket-exchange.json");
const TICKET_EXCHANGE_ROWS = (2 << 16) | 2;
const TICKET_EXCHANGE_ROW_OP_FLAGS = 0x43e;
const TICKET_EXCHANGE_QUANTITY_VARBIT = 6348;
const MAX_STACK = 2147483647;
const ITEM_OPTIONS = new Map([["value", "value"], ["buy 1", "buy1"], ["buy 5", "buy5"], ["buy x", "buyX"]]);
const OPTIONS_BY_QUANTITY = [
  { 1: "value", 3: "buy1", 4: "buy5", 5: "buyX" },
  { 1: "buy1", 2: "value", 4: "buy5", 5: "buyX" },
  { 1: "buy5", 2: "value", 3: "buy1", 5: "buyX" },
  { 1: "buyX", 2: "value", 3: "buy1", 4: "buy5" },
];
/** The guild's ground floor: doorman 2658,3439, target corner 2682,3428. */
const GUILD = { minX: 2653, maxX: 2687, minY: 3412, maxY: 3443, z: 0 };

let api;
let core;

function rangedLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.RANGED);
}

/** The fence runs diagonally, so the two sides are the two half-planes either side of x - y. */
function insideSide(point) {
  return point.x - point.y > DOOR.x - DOOR.y;
}

function insideGuild(point) {
  return point.z === GUILD.z && point.x >= GUILD.minX && point.x <= GUILD.maxX
    && point.y >= GUILD.minY && point.y <= GUILD.maxY && insideSide(point);
}

function inside(player) {
  const at = player.getLocation();
  return insideGuild({ x: at.getX(), y: at.getY(), z: at.getZ() });
}

function refuse(player) {
  api.emitCustomEvent("npc-dialogue:start", {
    player,
    npcId: core.NpcIdentifiers.RANGING_GUILD_DOORMAN,
    variant: REFUSAL_VARIANT,
    handled: false,
  });
}

function openTicketExchange(player) {
  player.getPacketSender()
    .sendInterface(TICKET_EXCHANGE_INTERFACE)
    .sendInterfaceFlagsRange(TICKET_EXCHANGE_ROWS, 0, TICKET_EXCHANGE_ITEMS.length - 1, TICKET_EXCHANGE_ROW_OP_FLAGS);
}

function canShop(event) {
  if (event.shopId !== TICKET_EXCHANGE_SHOP_ID || !event.player) return;
  event.allow = false;
  openTicketExchange(event.player);
}

function ticketExchangeQuantityMode(event) {
  if (event.groupId !== TICKET_EXCHANGE_INTERFACE || !Number.isInteger(event.childId)
    || event.childId < 6 || event.childId > 9 || event.action !== 1) return false;
  event.handled = true;
  event.player.getPacketSender().sendVarbit(TICKET_EXCHANGE_QUANTITY_VARBIT, event.childId - 6);
  return true;
}

function rowFromClick(event) {
  if (event.groupId !== TICKET_EXCHANGE_INTERFACE || event.childId !== (TICKET_EXCHANGE_ROWS & 0xffff)) return null;
  const entry = Number.isInteger(event.slot) ? TICKET_EXCHANGE_ITEMS[event.slot] : null;
  const itemId = entry ? core.ItemIdentifiers[entry.item] : null;
  if (!entry || !Number.isInteger(itemId) || (Number.isInteger(event.itemId) && event.itemId >= 0 && event.itemId !== itemId)) return null;
  return { itemId, tickets: entry.tickets, perSet: entry.perSet };
}

function actionFromClick(event) {
  const label = String(event.option ?? "").trim().toLowerCase();
  if (ITEM_OPTIONS.has(label)) return ITEM_OPTIONS.get(label);
  const mode = event.player.getPacketSender().getVarbit(TICKET_EXCHANGE_QUANTITY_VARBIT);
  // Script 3640 uses its default options for modes from other shops, including Buy 50.
  return (OPTIONS_BY_QUANTITY[mode] ?? OPTIONS_BY_QUANTITY[0])[event.action] ?? null;
}

function maximumSets(player, row) {
  const inventory = player.getInventory();
  const affordable = Math.floor(inventory.getAmount(core.ItemIdentifiers.ARCHERY_TICKET) / row.tickets);
  if (affordable < 1) return 0;
  const addable = inventory.getAddableAmount(new core.Item(row.itemId, MAX_STACK));
  return Math.min(affordable, Math.floor(addable / row.perSet));
}

function buySets(player, row, requested) {
  if (!Number.isInteger(requested) || requested < 1) return 0;
  const max = maximumSets(player, row);
  if (max < 1) {
    const inventory = player.getInventory();
    if (inventory.getAmount(core.ItemIdentifiers.ARCHERY_TICKET) < row.tickets) {
      player.sendMessage("You don't have enough Archery tickets.");
    } else {
      player.sendMessage("You couldn't hold all those items.");
    }
    return 0;
  }
  const sets = Math.min(requested, max);
  const ticketCost = sets * row.tickets;
  const amount = sets * row.perSet;
  const inventory = player.getInventory();
  inventory.deleteNumber(core.ItemIdentifiers.ARCHERY_TICKET, ticketCost);
  inventory.adds(row.itemId, amount);
  return sets;
}

function ticketExchangeClick(event) {
  if (!event?.player || !event.player.getPacketSender().isSubInterfaceOpen(TICKET_EXCHANGE_INTERFACE)) return false;
  if (ticketExchangeQuantityMode(event)) return true;
  const row = rowFromClick(event);
  if (!row) return false;
  if (event.action === 10 || String(event.option ?? "").trim().toLowerCase() === "examine") {
    event.handled = true;
    event.player.sendMessage(core.ItemDefinition.forId(row.itemId).getExamine());
    return true;
  }
  const action = actionFromClick(event);
  if (!action) return false;
  event.handled = true;

  if (action === "value") {
    const name = core.ItemDefinition.forId(row.itemId).getName();
    event.player.sendMessage(`${row.perSet.toLocaleString("en-US")} ${name} cost ${row.tickets.toLocaleString("en-US")} Archery tickets.`);
  } else if (action === "buy1" || action === "buy5") {
    buySets(event.player, row, action === "buy1" ? 1 : 5);
  } else {
    const maximum = maximumSets(event.player, row);
    if (maximum < 1) {
      buySets(event.player, row, 1);
    } else {
      event.player.setEnteredAmountAction({
        execute: (amount) => {
          if (!event.player.getPacketSender().isSubInterfaceOpen(TICKET_EXCHANGE_INTERFACE)) return;
          buySets(event.player, row, Math.min(maximum, Math.floor(Number(amount) || 0)));
        },
      });
      event.player.getPacketSender().sendEnterAmountPrompt(`How many sets would you like to buy? (0 - ${maximum.toLocaleString("en-US")})`);
    }
  }
  return true;
}

/** Doors' door:toggle, before the pass-through gate carries the opener across. */
function guardDoor(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.GUILD_DOOR) return;
  const { player } = request;
  if (inside(player)) return; // leaving is never stopped
  if (rangedLevel(player) >= REQUIRED_LEVEL) {
    // Let the gate carry them across: entering by the door is the Kandarin Diary's "Enter the Ranging Guild".
    api.emitCustomEvent("diary:task", { player, diary: "kandarin", task: "enter-the-ranging-guild" });
    return;
  }
  request.handled = true;
  refuse(player);
}

module.exports = {
  name: "RangingGuild",
  description: "Lets players through the Ranging Guild door only with 40 Ranged, the doorman turning others away.",
  members: true,
  _test: { guardDoor, inside, insideGuild, rangedLevel, canShop, openTicketExchange, ticketExchangeQuantityMode, ticketExchangeClick, maximumSets, buySets, REQUIRED_LEVEL, REFUSAL_VARIANT, DOOR, GUILD, TICKET_EXCHANGE_SHOP_ID },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("door:toggle", guardDoor);
    api.onCanShop(canShop);
    api.onInterfaceActionClick(ticketExchangeClick);
  },
};

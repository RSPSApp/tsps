"use strict";

/**
 * House servants (Wiki: Servant): hiring at the Servants' Guild, the Chief servant, and the hired
 * servant's work in the house. Each servant speaks its own lines (data/servants.json); where a
 * servant has no line for a situation, the flow goes on without one.
 */
const { api, PluginManager, World, Item, Skill, Bank, ItemDefinition, PathFinder, NpcIdentifiers: Npcs, ItemIdentifiers: Items,
  DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue, ActionDialogue, EndDialogue } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const LINES = require("./data/servants.json");
const SERVANT_TYPE_VARBIT = Ids.varbit("poh_servant_type");
const SERVANT_PAY_VARBIT = Ids.varbit("poh_servant_pay");
const SERVANT_LAST_TASK_VARBIT = Ids.varbit("poh_servant_lasttasktype");
const Instance = require("./Instance.Construction");
const House = require("./House.Construction");
const Estate = require("./Estate.Construction");
// Guild NPCs are the following cache morphs; varbit 2190 hides the hired candidate.
const SERVANTS = [
  { id: Npcs.RICK, key: "poh_servant_dogsbody", type: 1, level: 20, wage: 500, capacity: 6, ticks: 100, food: Items.SHRIMPS },
  { id: Npcs.MAID, key: "poh_servant_waiter_woman", type: 3, level: 25, wage: 1000, capacity: 10, ticks: 50, food: Items.STEW },
  { id: Npcs.COOK, key: "poh_servant_cook_woman", type: 5, level: 30, wage: 3000, capacity: 16, ticks: 29, food: Items.PINEAPPLE_PIZZA },
  { id: Npcs.BUTLER, key: "poh_servant_maitre_d_man", type: 6, level: 40, wage: 5000, capacity: 20, ticks: 20, food: Items.CHOCOLATE_CAKE },
  { id: Npcs.DEMON_BUTLER, key: "poh_servant_demon", type: 8, level: 50, wage: 10000, capacity: 26, ticks: 12, food: Items.CURRY },
];
for (const servant of SERVANTS) {
  if (Ids.npc(servant.key) !== servant.id) throw new Error(`Construction: ${servant.key} is not npc ${servant.id}`);
}
/**
 * The wage buys 16 points of work (poh_servant_pay): an errand (bank, fetch, un-note, sawmill)
 * takes 2, tea 1, dinner 2, sending held items back to the bank 1. At 0 the servant asks for the
 * wage again.
 */
const FULL_PAY = 16;
const ERRAND_COST = 2;
const TAKE_BACK_COST = 1;
const MEAL_COST = { tea: 1, dinner: 2, drinks: 0 };
// The tea is ready 40 ticks after it was asked for, whoever makes it. Ours: drinks after 27.
const MEAL_TICKS = { tea: 40, drinks: 27 };
const TASK_TYPES = { bank: 1, unnote: 2, fetch: 3, sawmill: 4 };
const TASK_LABELS = { bank: "Take to bank", unnote: "Un-note", fetch: "Fetch from bank", sawmill: "Take to sawmill" };
const runtimes = new WeakMap();
const MATERIALS = [Items.PLANK, Items.OAK_PLANK, Items.TEAK_PLANK, Items.MAHOGANY_PLANK,
  Items.SOFT_CLAY, Items.LIMESTONE_BRICK, Items.STEEL_BAR, Items.BOLT_OF_CLOTH,
  Items.GOLD_LEAF, Items.MARBLE_BLOCK, Items.MAGIC_STONE];
const MATERIAL_LABELS = ["Wooden planks", "Oak planks", "Teak planks", "Mahogany planks", "Soft clay", "Limestone brick",
  "Steel bar", "Cloth", "Gold leaf", "Marble block", "Magic housing stone"];
// The fetch list's pages; "More..." on the last one goes back to the first.
const MATERIAL_PAGES = [[0, 4], [4, 8], [8, 11]];
const SAWMILL = new Map([
  [Items.LOGS, [Items.PLANK, 100]], [Items.OAK_LOGS, [Items.OAK_PLANK, 250]],
  [Items.TEAK_LOGS, [Items.TEAK_PLANK, 500]], [Items.MAHOGANY_LOGS, [Items.MAHOGANY_PLANK, 1500]],
  [Items.CAMPHOR_LOGS, [Items.CAMPHOR_PLANK, 2500]], [Items.IRONWOOD_LOGS, [Items.IRONWOOD_PLANK, 5000]],
  [Items.ROSEWOOD_LOGS, [Items.ROSEWOOD_PLANK, 7500]],
]);
const TEAS = [Items.CUP_OF_TEA_9, Items.CUP_OF_TEA_11, Items.CUP_OF_TEA_13];
const DRINKS = { BEER_BARREL: Items.BEER_3, CIDER_BARREL: Items.CIDER_3,
  ASGARNIAN_ALE_BARREL: Items.ASGARNIAN_ALE_3, GREENMANS_ALE_BARREL: Items.GREENMANS_ALE_3,
  DRAGON_BITTER_BARREL: Items.DRAGON_BITTER_3, CHEFS_DELIGHT_BARREL: Items.CHEFS_DELIGHT_3 };
const HOUSE_ITEMS = [...TEAS.flatMap(id => [id, id + 1]), Items.EMPTY_CUP_3,
  Items.PORCELAIN_CUP_2, Items.PORCELAIN_CUP_3, Items.BEER_GLASS_4, ...Object.values(DRINKS)];

function keys(room) {
  return [...Object.values(room.furniture), ...Object.values(room.furnitureByLocation ?? {}).map(f => f.buildableKey)];
}
function rooms(save) { return save.rooms.flat(2).filter((r) => !!r); }
function has(save, key) { return rooms(save).some(r => keys(r).includes(key)); }
function hasServantBeds(save) {
  return rooms(save).filter(r => r.roomKey === "BEDROOM" && keys(r).some(k => k.endsWith("_BED"))).length >= 2;
}
function hasBellPull(save) { return rooms(save).some(r => keys(r).some(k => k.endsWith("BELL_PULL"))); }
function definition(save) { return SERVANTS.find(s => s.id === save.servant?.id); }
/** The work left before the next wage. Saves from before the counter held `uses` (8 a wage). */
function payLeft(servant) {
  if (!servant) return 0;
  if (!Number.isSafeInteger(servant.pay)) {
    servant.pay = Math.max(0, FULL_PAY - ERRAND_COST * (Number(servant.uses) || 0));
    delete servant.uses;
  }
  return servant.pay;
}
function charge(servant, cost) { servant.pay = Math.max(0, payLeft(servant) - cost); }
function persist(player) {
  const save = House.houseStateFor(player);
  player.setAttribute(Data.HOUSE_ATTRIBUTE, save);
  const sender = player.getPacketSender();
  sender.sendVarbit(SERVANT_TYPE_VARBIT, definition(save)?.type ?? 0);
  sender.sendVarbit(SERVANT_PAY_VARBIT, definition(save) ? payLeft(save.servant) : 0);
  sender.sendVarbit(SERVANT_LAST_TASK_VARBIT, TASK_TYPES[save.servant?.lastTask?.kind] ?? 0);
}

// Every chathead the lines use, checked against the cache when the plugin loads.
const FACES = new Map();
(function faces(value) {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" && /^chat/.test(value[1])) {
    FACES.set(value[1], Ids.seq(value[1]));
  } else if (value && typeof value === "object") Object.values(value).forEach(faces);
})(LINES);
FACES.set("chatneu1", Ids.seq("chatneu1"));
function face(name) { return FACES.get(name) ?? Ids.seq(name); }
function coins(amount) { return amount.toLocaleString("en-US"); }
function fill(player, text, vars = {}) {
  const male = player.getAppearance?.()?.isMale?.() !== false;
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (name === "sir") return male ? "sir" : "madam";
    if (name === "Sir") return male ? "Sir" : "Madam";
    if (name === "he") return male ? "he" : "she";
    return name in vars ? String(vars[name]) : match;
  });
}
/** A situation's lines: one [text, chathead] or a list of them; none when the servant has no line. */
function linesOf(table, situation) {
  const entry = table?.[situation];
  if (!entry) return [];
  return Array.isArray(entry[0]) ? entry : [entry];
}
/**
 * Plays a conversation, then `onEnd` once its last line is continued. A step is
 * `{ npc, lines }`, `{ player: line }` or `{ mesbox: text }`; `vars` fill {cost}-style blanks.
 */
function converse(player, steps, onEnd = null, vars = {}) {
  const entries = [];
  for (const step of steps) {
    if (step.mesbox) entries.push((index) => new StatementDialogue(index, step.mesbox));
    else if (step.player) entries.push((index) => new PlayerDialogue(index, fill(player, step.player[0], vars), face(step.player[1])));
    else for (const [text, head] of step.lines) entries.push((index) => new NpcDialogue(index, step.npc, fill(player, text, vars), undefined, face(head)));
  }
  if (!entries.length) { onEnd?.(); return; }
  const builder = new DialogueChainBuilder();
  entries.forEach((entry, index) => builder.add(entry(index)));
  builder.add(onEnd ? new ActionDialogue(entries.length, { execute: onEnd }) : new EndDialogue(entries.length));
  player.getDialogueManager().startDialogues(builder);
}
function npcSays(def, situation, npcId = def.id) { return { npc: npcId, lines: linesOf(LINES[def.key], situation) }; }
function playerSays(situation) { return { player: LINES.player[situation] }; }
function menu(player, title, ...options) { api.sendMultiChatboxPrompt(player, title, ...options); }
function amountPrompt(player, action) {
  player.setEnteredAmountAction({ acceptsZero: true, execute: (count) => action(Math.max(0, Math.floor(Number(count) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function ownerContext(player) {
  const runtime = runtimes.get(player);
  return runtime && !runtime.absent && runtime.house.owner === player && player.getPrivateArea() === runtime.house
    && !runtime.house.isDestroyed() && hasServantBeds(runtime.house.save) && definition(runtime.house.save) ? runtime : undefined;
}
/** A menu choice or continued line acts only while the servant is still there and home. */
function present(player, runtime) {
  return ownerContext(player) === runtime && !!runtime.npc && runtime.due === undefined;
}
function removeNpc(runtime) {
  if (!runtime.npc) return;
  const npc = runtime.npc;
  runtime.npc = undefined;
  if (runtime.guide?.guest.getFollowing() === npc) runtime.guide.guest.setFollowing(null);
  runtime.guide = undefined;
  runtime.house.leave(npc, false);
  PluginManager.removeNpc(npc);
}
function spawn(player, runtime, location = player.getLocation()) {
  if (runtime.npc || runtime.absent || runtime.due !== undefined || !definition(runtime.house.save)) return;
  const npc = PluginManager.spawnNpc({ id: runtime.house.save.servant.id, x: location.x, y: location.y, z: location.z, wanderRadius: 0 });
  if (!npc) return;
  runtime.npc = npc;
  runtime.house.enter(npc);
}
function cargoBank(player, id, meta) {
  const banks = player.getBanks().slice(0, Bank.BANK_SEARCH_TAB_INDEX).filter(Boolean);
  return banks.find(bank => bank.getItems().some(item => item.getId() === id
    && JSON.stringify(item.getMeta() ?? null) === JSON.stringify(meta ?? null)))
    ?? banks.find(bank => bank.getFreeSlots() > 0);
}
function bankCargo(player) {
  const cargo = House.houseStateFor(player).servant?.cargo;
  if (!cargo) return true;
  const bank = cargoBank(player, cargo.itemId, cargo.meta);
  if (!bank) return false;
  const before = bank.getAmount(cargo.itemId);
  const amount = Math.min(cargo.amount, Number.MAX_SAFE_INTEGER - before);
  if (amount > 0 && (bank.contains(cargo.itemId) || bank.getFreeSlots() > 0)) {
    bank.add(new Item(cargo.itemId, amount, cargo.meta), false);
    cargo.amount -= bank.getAmount(cargo.itemId) - before;
  }
  if (!cargo.amount) delete House.houseStateFor(player).servant.cargo;
  persist(player);
  return cargo.amount === 0;
}

/** Also called by the instance leave hook: teleporting and disconnecting cannot strand cargo. */
function leaveServantHouse(player, house) {
  // POH cups/drinks cannot be taken out of the house (including through a teleport).
  for (const id of HOUSE_ITEMS) {
    const amount = player.getInventory().getAmount(id);
    if (amount) player.getInventory().delete(id, amount);
  }
  if (house.owner !== player) return;
  const runtime = runtimes.get(player);
  if (runtime) { runtimes.delete(player); removeNpc(runtime); }
  if (house.save.servant?.cargo) bankCargo(player);
}
function enterServantHouse(player, house) {
  if (house.owner !== player) {
    const runtime = house.owner && runtimes.get(house.owner);
    if (runtime?.npc && house.save.servant?.greet) runtime.npc.forceChat(`Welcome to ${house.owner.getDisplayName()}'s house!`);
    return;
  }
  if (!definition(house.save)) return;
  const old = runtimes.get(player);
  if (old?.house === house) return;
  const runtime = { house, absent: !hasServantBeds(house.save) };
  runtimes.set(player, runtime);
  spawn(player, runtime);
}
function callServant(player) {
  const runtime = ownerContext(player);
  if (!runtime) { player.sendMessage("You need a hired servant and two bedrooms with beds in your own house."); return; }
  if (!hasBellPull(runtime.house.save)) {
    player.sendMessage("You need a bell-pull in your dining room to call your servant."); return;
  }
  if (runtime.due !== undefined || runtime.meal) { player.sendMessage(LINES.messages.notBack); return; }
  spawn(player, runtime);
  if (!runtime.npc) return;
  runtime.npc.getMovementQueue().reset();
  runtime.npc.moveTo(player.getLocation().clone());
  ownerTalk(player, runtime, true);
}
/**
 * House Options' Call Servant. Returns true when the servant is called (the panel then closes);
 * a refusal leaves it open.
 */
function callServantFromOptions(player) {
  const house = player.getPrivateArea();
  // Ours: a guest in someone else's house gets the not-in-a-house line too.
  if (!(house instanceof Instance.PlayerHouseInstance) || house.owner !== player || house.isDestroyed()) {
    player.sendMessage("You're not in a house. You can't call your servant from here."); return false;
  }
  if (!definition(house.save)) { player.sendMessage("You must hire a servant from the Servants' Guild in Ardougne first."); return false; }
  if (!hasBellPull(house.save)) {
    player.sendMessage("You need a bell pull in your house to be able to call your servant like this."); return false;
  }
  const runtime = ownerContext(player);
  if (runtime?.due !== undefined || runtime?.meal) { player.sendMessage(LINES.messages.notBack); return false; }
  if (!runtime) { player.sendMessage("You need a hired servant and two bedrooms with beds in your own house."); return false; }
  player.sendMessage(LINES.messages.onTheWay);
  callServant(player);
  return true;
}

/**
 * With the work used up, the money bag pays the wage by itself when it holds enough. Returns
 * whether the servant is paid up.
 */
function payFromMoneyBag(player) {
  const save = House.houseStateFor(player), servant = save.servant, def = definition(save);
  if (!def || !servant) return false;
  if (payLeft(servant) > 0) return true;
  if (!has(save, "SERVANTS_MONEYBAG") || (save.servantMoney ?? 0) < def.wage) return false;
  save.servantMoney -= def.wage;
  servant.pay = FULL_PAY;
  persist(player);
  player.sendMessage(fill(player, LINES.messages.moneyBagPaid, { coins: coins(save.servantMoney) }));
  return true;
}
/** The wage from the inventory. Returns whether it was paid. */
function payServant(player) {
  const save = House.houseStateFor(player), servant = save.servant, def = definition(save);
  if (!def || !servant) return false;
  if (payLeft(servant) > 0 || payFromMoneyBag(player)) return true;
  if (player.getInventory().getAmount(Items.COINS) < def.wage) return false;
  player.getInventory().delete(Items.COINS, def.wage);
  servant.pay = FULL_PAY;
  persist(player);
  return true;
}
/** Hands over what the servant carries; returns how many it still holds. */
function deliver(player) {
  const servant = House.houseStateFor(player).servant, cargo = servant?.cargo;
  if (!cargo || cargo.bank) return 0;
  const inventory = player.getInventory(), before = inventory.getAmount(cargo.itemId);
  const stackable = ItemDefinition.forId(cargo.itemId).isStackable();
  const space = stackable ? (inventory.contains(cargo.itemId) || inventory.getFreeSlots() > 0 ? Number.MAX_SAFE_INTEGER - before : 0) : inventory.getFreeSlots();
  const amount = Math.min(cargo.amount, space);
  if (amount > 0) inventory.adds(cargo.itemId, amount);
  cargo.amount -= inventory.getAmount(cargo.itemId) - before;
  if (!cargo.amount) delete servant.cargo;
  persist(player);
  ownerContext(player)?.npc?.setFollowing(servant.cargo ? player : null);
  return servant.cargo?.amount ?? 0;
}
/**
 * The servant hands its items over, or says it will wait while the inventory is full (asked
 * again with no room, the game says so first).
 */
function handOver(player, runtime, asked = false) {
  const def = definition(runtime.house.save);
  const held = deliver(player);
  if (!held) { converse(player, [npcSays(def, "returned")]); return; }
  if (asked) player.getPacketSender().sendMessage(LINES.messages.noInventorySpace);
  const prompt = () => {
    if (!present(player, runtime) || !House.houseStateFor(player).servant?.cargo) return;
    menu(player, "Select an option",
      "Take them back to the bank", () => converse(player, [playerSays("takeBack"), npcSays(def, "takeBack")], () => {
        if (present(player, runtime)) returnCargo(player);
      }),
      "Thanks", () => converse(player, [playerSays("thanks")]));
  };
  converse(player, [npcSays(def, "returnedFull")], prompt, { count: held });
}
function startServantTask(player, task) {
  const runtime = ownerContext(player), save = House.houseStateFor(player), servant = save.servant, def = definition(save);
  if (!runtime || !servant || !def || runtime.due !== undefined || runtime.guide || runtime.meal) return false;
  if (!Number.isSafeInteger(task.amount) || task.amount < 1 || !Number.isSafeInteger(task.itemId) || task.itemId < 1) return false;
  if (!payFromMoneyBag(player)) return false;
  if (servant.cargo) return false;
  if (PluginManager.emitCanBank(player) === false) return false;
  const inventory = player.getInventory(), input = ItemDefinition.forId(task.itemId);
  const id = input.unNote(), item = new Item(task.itemId, task.amount, task.meta);
  if (!carriable(player, item)) return false;
  let amount = Math.min(task.amount, def.capacity), output = id, cost = 0;
  const containers = task.kind === "fetch" ? player.getBanks().slice(0, Bank.BANK_SEARCH_TAB_INDEX) : [inventory];
  const sources = containers.filter(Boolean).flatMap(container => container.getItems().map((held, slot) => ({ container, held, slot })))
    .filter(({ held }) => held.getId() === task.itemId && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(task.meta ?? null));
  amount = Math.min(amount, sources.reduce((sum, { held }) => sum + held.getAmount(), 0));
  if (task.kind === "fetch") {
    if (!MATERIALS.includes(task.itemId) || task.meta) return false;
  } else {
    if (task.meta && task.kind !== "bank") return false;
    if (task.kind === "unnote" && !input.isNoted()) return false;
    if (task.kind === "sawmill") {
      const recipe = SAWMILL.get(id);
      if (input.isNoted() || !recipe || def.level < 30) return false;
      [output, cost] = recipe;
      amount = Math.min(amount, Math.floor(inventory.getAmount(Items.COINS) / cost));
    }
  }
  if (amount <= 0) return false;
  if (task.kind === "bank") {
    const bank = cargoBank(player, id, task.meta);
    if (!bank || !Number.isSafeInteger(bank.getAmount(id) + amount)) return false;
  }
  let remaining = amount;
  for (const { container, held, slot } of sources) {
    const taken = Math.min(remaining, held.getAmount());
    if (taken) container.deleteAtSlot(slot, taken, false);
    remaining -= taken;
    if (!remaining) break;
  }
  if (task.kind !== "fetch") inventory.refreshItems();
  if (cost) inventory.delete(Items.COINS, cost * amount);
  servant.cargo = { itemId: output, amount, bank: task.kind === "bank", meta: Item.cloneMeta(task.meta) };
  servant.lastTask = { ...task, amount };
  charge(servant, ERRAND_COST);
  runtime.due = World.getProcessCycle() + def.ticks;
  removeNpc(runtime);
  persist(player);
  return true;
}
/** Bones, house cups and drinks, and what the bank refuses stay with the player. */
function carriable(player, item) {
  const id = item.getDefinition().unNote();
  return !HOUSE_ITEMS.includes(id) && !isBones(id) && !item.isUnbankable() && PluginManager.emitCanBankItem(player, item) !== false;
}
function isBones(id) { return /\bbones\b/i.test(ItemDefinition.forId(id).getName()); }

function fireServant(player) {
  const save = House.houseStateFor(player);
  if (!definition(save)) return false;
  if (!bankCargo(player)) { player.sendMessage("Make room in your bank for the items your servant is holding before dismissing them."); return false; }
  const runtime = runtimes.get(player);
  if (runtime) { removeNpc(runtime); runtimes.delete(player); }
  delete save.servant;
  persist(player);
  return true;
}
function atNpc(event) {
  return event.npc.getPrivateArea() === event.player.getPrivateArea() && event.player.getLocation().getZ() === event.npc.getLocation().getZ()
    && event.player.getLocation().getDistance(event.npc.getLocation()) <= 6;
}

/** The guild's servants: their greeting, then what they can do, their old jobs, or hiring them. */
function guildTalk(event, def) {
  const player = event.player, head = event.npcId;
  converse(player, [npcSays(def, "greeting", head)], () => menu(player, "Select an option",
    "What can you do?", () => converse(player, [playerSays("whatCanYouDo"), npcSays(def, "whatCanYouDo", head)]),
    "Tell me about your previous jobs", () => converse(player, [playerSays("previousJobs"), npcSays(def, "previousJobs", head)]),
    "You're hired!", () => hire(event, def)));
}
function hire(event, def) {
  const player = event.player, save = House.houseStateFor(player), head = event.npcId;
  if (!atNpc(event) || player.getPrivateArea()) return;
  const level = player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION);
  if (level < def.level) { converse(player, [npcSays(def, "levelTooLow", head)], null, { level }); return; }
  if (definition(save)) { converse(player, [{ mesbox: LINES.messages.alreadyHired }]); return; }
  // Ours: without a house there is no second bedroom either.
  if (save.owned === false || !hasServantBeds(save)) { converse(player, [{ mesbox: LINES.messages.noBedroom }]); return; }
  if (player.getInventory().getAmount(Items.COINS) < def.wage) {
    converse(player, [playerSays(has(save, "SERVANTS_MONEYBAG") ? "cannotPayMoneyBag" : "cannotPay"), npcSays(def, "cannotPay", head)]);
    return;
  }
  converse(player, [playerSays("hired"), npcSays(def, "hired", head)], () => {
    if (definition(save) || !hasServantBeds(save) || player.getInventory().getAmount(Items.COINS) < def.wage) return;
    player.getInventory().delete(Items.COINS, def.wage);
    save.servant = { id: def.id, pay: FULL_PAY };
    persist(player);
  });
}
function chiefTalk(event) {
  const player = event.player, chief = LINES.chief, head = event.npcId;
  const says = (situation) => ({ npc: head, lines: linesOf(chief, situation) });
  const hired = !!definition(House.houseStateFor(player));
  const first = hired
    ? ["I'd like to dismiss my servant, please.", () => converse(player, [{ player: chief.playerDismiss }, says("dismissSure")], () => menu(player, "Select an option",
      "Yes, I want to dismiss my servant.", () => converse(player, [{ player: chief.playerDismissYes }], () => {
        if (fireServant(player)) converse(player, [says("dismissed")]);
      }),
      "No, I'll keep my servant for now.", () => converse(player, [{ player: chief.playerDismissNo }])))]
    : ["Tell me about servants.", () => converse(player, [{ player: chief.playerAbout }, says("aboutServants")])];
  converse(player, [says("welcome")], () => menu(player, "Select an option", ...first,
    "Can I hire a servant?", () => {
      const save = House.houseStateFor(player);
      const answer = save.owned === false ? "noHouse" : definition(save) ? "hasServant" : !hasServantBeds(save) ? "noBedrooms" : "canHire";
      converse(player, [{ player: chief.playerHire }, says(answer)]);
    },
    "Thank you.", () => converse(player, [{ player: chief.playerThanks }])));
}

/** What a repeat would take: the item has to be where the task takes it from. */
function repeatable(player, task) {
  if (!task || !TASK_TYPES[task.kind]) return false;
  const containers = task.kind === "fetch" ? player.getBanks().slice(0, Bank.BANK_SEARCH_TAB_INDEX) : [player.getInventory()];
  return containers.filter(Boolean).some(container => container.getItems().some(held => held?.getId() === task.itemId
    && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(task.meta ?? null)));
}
function taskLabel(task) {
  const name = ItemDefinition.forId(ItemDefinition.forId(task.itemId).unNote()).getName();
  return `${TASK_LABELS[task.kind]}: ${task.amount} x ${name}`;
}
/**
 * Talk-to (and the bell or Call Servant): the wage when it is due, the held items, else a repeat
 * of the last task or the servant's greeting and its menu.
 */
function ownerTalk(player, runtime, rang = false) {
  const save = runtime.house.save, servant = save.servant, def = definition(save);
  if (!def || !servant || !runtime.npc || runtime.meal) return;
  if (payLeft(servant) === 0 && !payFromMoneyBag(player)) { demandWage(player, runtime); return; }
  if (servant.cargo && !servant.cargo.bank) { handOver(player, runtime, true); return; }
  const last = servant.lastTask;
  if (repeatable(player, last)) {
    menu(player, "Repeat last task?", taskLabel(last), () => { if (present(player, runtime)) startServantTask(player, last); },
      "Something else...", () => { if (present(player, runtime)) mainMenu(player, runtime); });
    return;
  }
  converse(player, [npcSays(def, rang ? "rang" : "ready")], () => { if (present(player, runtime)) mainMenu(player, runtime); });
}
function demandWage(player, runtime) {
  const save = runtime.house.save, def = definition(save);
  const line = has(save, "SERVANTS_MONEYBAG") && LINES[def.key].payDemandMoneyBag ? "payDemandMoneyBag" : "payDemand";
  const steps = [npcSays(def, line)];
  // Ours: a servant with no line of its own says so in a game message.
  if (!steps[0].lines.length) player.sendMessage(`Your servant requires ${coins(def.wage)} coins.`);
  const options = [];
  if (player.getInventory().getAmount(Items.COINS) >= def.wage) {
    const text = `Okay, here's ${coins(def.wage)} coins.`;
    options.push(text, () => converse(player, [{ player: [text, "chatneu1"] }], () => {
      if (!present(player, runtime) || !payServant(player)) return;
      const paid = [npcSays(def, "paid")];
      converse(player, paid, () => { if (present(player, runtime) && save.servant?.cargo) handOver(player, runtime); });
    }));
  }
  options.push("I'll pay you later.", () => converse(player, [playerSays("payLater")]),
    "You're fired!", () => confirmFire(player, runtime));
  converse(player, steps, () => menu(player, "Select an option", ...options));
}
function confirmFire(player, runtime) {
  const def = definition(runtime.house.save);
  menu(player, "Do you really want to fire your servant?",
    "Yes", () => converse(player, [playerSays("fired"), npcSays(def, "fired")], () => { if (ownerContext(player) === runtime) fireServant(player); }),
    "No", () => {});
}
function mainMenu(player, runtime) {
  const def = definition(runtime.house.save);
  const act = (action) => () => { if (present(player, runtime)) action(); };
  menu(player, "Select an option",
    "Serve...", act(() => serveMenu(player, runtime)),
    "Go to the bank...", act(() => bankMenu(player, runtime)),
    "Go to the sawmill...", act(() => converse(player, [npcSays(def, "sawmill")])),
    "Greet guests", act(() => converse(player, [playerSays("greet"), npcSays(def, "greet")], () => greetGuests(player, runtime))),
    "You're fired", act(() => confirmFire(player, runtime)));
}
function greetGuests(player, runtime) {
  if (!present(player, runtime)) return;
  runtime.house.save.servant.greet = true;
  runtime.npc.setFollowing(null);
  runtime.npc.moveTo(runtime.house.getEntryLocation());
  persist(player);
}
function bankMenu(player, runtime) {
  const def = definition(runtime.house.save);
  menu(player, "Select an option",
    "Take something to the bank", () => converse(player, [playerSays("takeToBank"), npcSays(def, "takeToBank")]),
    "Bring something from the bank", () => converse(player, [playerSays("fetchFromBank")], () => {
      const ask = () => { if (present(player, runtime)) converse(player, [npcSays(def, "fetchFromBank")], () => fetchMenu(player, runtime)); };
      const request = { player, feature: "servant", resume: ask };
      api.emitCustomEvent("bank-pin:guard", request);
      if (!request.locked) ask();
    }));
}
function fetchMenu(player, runtime, page = 0) {
  if (!present(player, runtime)) return;
  const [from, to] = MATERIAL_PAGES[page], options = [];
  for (let index = from; index < to; index++) options.push(MATERIAL_LABELS[index], () => fetchMaterial(player, runtime, MATERIALS[index]));
  options.push("More...", () => fetchMenu(player, runtime, (page + 1) % MATERIAL_PAGES.length));
  menu(player, "Select an option", ...options);
}
function bankAmount(player, id) {
  return player.getBanks().slice(0, Bank.BANK_SEARCH_TAB_INDEX).filter(Boolean).reduce((sum, bank) => sum + bank.getAmount(id), 0);
}
function fetchMaterial(player, runtime, id) {
  if (!present(player, runtime)) return;
  const def = definition(runtime.house.save);
  if (!bankAmount(player, id)) {
    const steps = [npcSays(def, "noneInBank")];
    // Ours: a servant with no line of its own says so in a game message.
    if (!steps[0].lines.length) player.sendMessage("You don't have any of those in your bank.");
    converse(player, steps);
    return;
  }
  amountPrompt(player, (amount) => {
    if (!present(player, runtime)) return;
    if (!amount) { converse(player, [npcSays(def, "zeroFetch")]); return; }
    const task = { kind: "fetch", itemId: id, amount };
    if (amount > def.capacity) converse(player, [npcSays(def, "overCapacity")], () => startServantTask(player, task));
    else startServantTask(player, task);
  });
}

function serveMenu(player, runtime) {
  menu(player, "Select an option",
    "Tea", () => serve(player, runtime, "tea"),
    "Dinner", () => serve(player, runtime, "dinner"),
    "Drinks", () => serve(player, runtime, "drinks"));
}
/** The kitchen a meal is made in: drinks need a barrel; tea and dinner a larder, shelves and a stove; tea a sink too. */
function kitchenFor(save, kind) {
  return rooms(save).find(r => r.roomKey === "KITCHEN" && (kind === "drinks" ? keys(r).some(k => DRINKS[k])
    : keys(r).some(k => k.includes("LARDER")) && keys(r).some(k => /SHELVES/.test(k))
      && keys(r).some(k => /OVEN|RANGE|FIREPIT_WITH/.test(k)) && (kind !== "tea" || keys(r).some(k => /SINK|PUMP/.test(k)))));
}
function hasDiningTable(save) { return rooms(save).some(r => r.roomKey === "DINING_ROOM" && keys(r).some(k => /TABLE/.test(k))); }
/**
 * While a meal is being made the servant works in the kitchen: no second meal or errand is
 * taken, and talking or calling waits until it is done (ours: a call says it is not back yet).
 * A dinner left on the table takes no second dinner until it is eaten.
 *
 * Tea and dinner: the servant agrees, takes its pay and then finds out whether the kitchen is
 * good enough (dinner checks the dining table first, before any pay). Drinks: the player asks,
 * and without a barrel the servant says so.
 */
function serve(player, runtime, kind) {
  if (!present(player, runtime) || runtime.meal || (kind === "dinner" && runtime.table)) return;
  const save = runtime.house.save, def = definition(save), servant = save.servant;
  const refuse = (situation, fallback) => {
    const steps = [npcSays(def, situation)];
    // Ours: a servant with no line of its own says so in a game message.
    if (!steps[0].lines.length && fallback) player.sendMessage(fallback);
    return steps;
  };
  if (kind === "drinks") {
    if (!kitchenFor(save, "drinks")) { converse(player, [playerSays("drinks"), ...refuse("noDrinks", "You need a kitchen with a barrel for your servant to serve drinks.")]); return; }
    converse(player, [playerSays("drinks"), npcSays(def, "drinks")], () => prepare(player, runtime, "drinks"));
    return;
  }
  converse(player, [npcSays(def, kind)], () => {
    if (!present(player, runtime)) return;
    if (kind === "dinner" && !hasDiningTable(save)) { converse(player, refuse("noDiningTable", "You need a dining table for your servant to serve dinner.")); return; }
    charge(servant, MEAL_COST[kind]);
    persist(player);
    if (!kitchenFor(save, kind)) { converse(player, [npcSays(def, "noKitchen"), { mesbox: LINES.messages.kitchen }]); return; }
    prepare(player, runtime, kind);
  });
}
function prepare(player, runtime, kind) {
  const save = runtime.house.save, room = kitchenFor(save, kind);
  if (!present(player, runtime) || !room || runtime.meal || (kind === "dinner" && runtime.table)) return;
  const def = definition(save), kitchen = keys(room);
  const tier = kitchen.includes("TEAK_SHELVES_2") ? 2 : kitchen.some(k => ["WOODEN_SHELVES_3", "OAK_SHELVES_2", "TEAK_SHELVES_1"].includes(k)) ? 1 : 0;
  const itemId = kind === "tea" ? TEAS[tier] : kind === "dinner" ? def.food : DRINKS[kitchen.find(k => DRINKS[k])];
  runtime.meal = { kind, itemId, ready: World.getProcessCycle() + (MEAL_TICKS[kind] ?? def.ticks) };
}
function give(recipient, itemId) {
  if (recipient.getInventory().getFreeSlots() === 0) { recipient.getPacketSender().sendMessage(LINES.messages.noInventorySpace); return false; }
  recipient.getInventory().adds(itemId, 1);
  return true;
}
/** The servant brings the tea or the drinks to the owner and offers them. */
function offerMeal(player, runtime, meal) {
  const def = definition(runtime.house.save);
  const still = () => present(player, runtime);
  if (meal.kind === "tea") {
    converse(player, [npcSays(def, "teaReady")], () => menu(player, "Select an option",
      "Yes please", () => converse(player, [playerSays("yesPlease")], () => { if (still()) give(player, meal.itemId + 1); }),
      "No thanks", () => converse(player, [playerSays("noThanks")], () => { if (still()) give(player, meal.itemId); }),
      "Actually I don't want any", () => converse(player, [playerSays("dontWantAny")])));
    return;
  }
  converse(player, [npcSays(def, "drinksReady")], () => menu(player, "Select an option",
    "Yes please", () => converse(player, [playerSays("drinkYes"), npcSays(def, "drinkServed")], () => {
      if (!still()) return;
      give(player, meal.itemId);
      // Ours: the guests get a drink too.
      for (const guest of runtime.house.getPlayers()) if (guest !== player && guest.getInventory().getFreeSlots() > 0) guest.getInventory().adds(meal.itemId, 1);
    }),
    "No thanks", () => converse(player, [playerSays("noThanks")]),
    "Something else", () => { if (still()) mainMenu(player, runtime); }));
}

/** Using an item on the servant: its question for that item, then the amount. */
function itemOnServant(event) {
  const player = event.player, runtime = ownerContext(player);
  if (!runtime || event.target !== runtime.npc) return;
  event.handled = true;
  const item = player.getInventory().getItems()[event.slot];
  if (!item || item.getId() !== event.itemId || runtime.due !== undefined || runtime.meal) return;
  const save = runtime.house.save, def = definition(save), input = item.getDefinition();
  if (payLeft(save.servant) === 0 && !payFromMoneyBag(player)) { demandWage(player, runtime); return; }
  if (isBones(input.unNote())) { converse(player, [npcSays(def, "bones")]); return; }
  if (!carriable(player, item)) { player.sendMessage("Your servant cannot carry that item."); return; }
  const meta = Item.cloneMeta(item.getMeta()), itemId = event.itemId;
  const ask = (kind) => () => {
    if (!present(player, runtime)) return;
    if (!bankHasRoom(player, input.unNote(), meta)) { converse(player, [npcSays(def, "bankFull")]); return; }
    amountPrompt(player, (amount) => {
      if (!present(player, runtime)) return;
      if (!amount) { converse(player, [npcSays(def, kind === "unnote" ? "zeroFetch" : "zeroBank")]); return; }
      const task = { kind, itemId, amount, meta };
      if (kind === "bank") converse(player, [npcSays(def, "banking")], () => { if (present(player, runtime)) startServantTask(player, task); });
      else startServantTask(player, task);
    });
  };
  if (input.isNoted()) {
    converse(player, [npcSays(def, "askNote")], () => menu(player, "Select an option",
      "Yes", ask("unnote"), "No, just take it to the bank.", ask("bank"),
      "No, never mind.", () => converse(player, [playerSays("neverMind")])));
  } else if (SAWMILL.has(itemId) && def.level >= 30) {
    converse(player, [npcSays(def, "askLogs")], () => menu(player, "Select an option",
      "Sawmill", () => sawmill(player, runtime, itemId), "Bank", ask("bank"),
      "Never mind", () => converse(player, [playerSays("neverMindLogs")])));
  } else {
    converse(player, [npcSays(def, "askBank")], () => menu(player, "Select an option",
      "Yes", ask("bank"), "No", () => converse(player, [playerSays("no")])));
  }
}
function bankHasRoom(player, id, meta) {
  const bank = cargoBank(player, id, meta);
  return !!bank && (bank.contains(id) || bank.getFreeSlots() > 0);
}
/** Logs to the sawmill: the amount, the servant names the fee, and the player agrees to it. */
function sawmill(player, runtime, logs) {
  if (!present(player, runtime)) return;
  const def = definition(runtime.house.save), [, fee] = SAWMILL.get(logs);
  amountPrompt(player, (amount) => {
    if (!present(player, runtime) || !amount) return;
    const count = Math.min(amount, def.capacity, player.getInventory().getAmount(logs));
    if (!count) return;
    const cost = count * fee;
    converse(player, [npcSays(def, "sawmillCost")], () => {
      if (!present(player, runtime)) return;
      if (player.getInventory().getAmount(Items.COINS) < cost) { converse(player, [playerSays("cannotAfford")]); return; }
      menu(player, `Convert the planks for ${cost} coins?`,
        "Yes", () => converse(player, [npcSays(def, "sawmillStart")], () => {
          if (present(player, runtime)) startServantTask(player, { kind: "sawmill", itemId: logs, amount: count });
        }),
        "No", () => {});
    }, { cost });
  });
}

function changeServantMoney(player, amount) {
  const house = player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance) || house.owner !== player || !has(house.save, "SERVANTS_MONEYBAG") || !Number.isSafeInteger(amount)) return false;
  const inventory = player.getInventory(), balance = house.save.servantMoney ?? 0;
  if (amount > 0) {
    amount = Math.floor(Math.min(amount, inventory.getAmount(Items.COINS), 3000000 - balance) / 100) * 100;
    if (!amount) return false;
    inventory.delete(Items.COINS, amount);
    house.save.servantMoney = balance + amount;
  } else {
    if (PluginManager.emitCanBank(player) === false) return false;
    // Only what the inventory can hold leaves the bag: a stack near the cap took the bag's full amount off and the
    // overflow was lost (the add stops at the cap).
    amount = inventory.getAddableAmount(new Item(Items.COINS, Math.min(-amount, balance)));
    if (!amount) return false;
    inventory.adds(Items.COINS, amount);
    house.save.servantMoney = balance - amount;
  }
  persist(player);
  player.sendMessage(`Your servant's money bag contains ${house.save.servantMoney} coins.`);
  return true;
}
function useServantFurniture(event) {
  const house = event.player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture) return false;
  if (furniture.hotspotKey === "BELL_PULL") { callServant(event.player); return true; }
  if (furniture.buildableKey !== "SERVANTS_MONEYBAG") return false;
  if (house.owner !== event.player) { event.player.sendMessage("Only the house owner can use the money bag."); return true; }
  api.sendMultiChatboxPrompt(event.player, `Money bag: ${house.save.servantMoney ?? 0} coins`,
    "Deposit coins", () => quantity(event.player, amount => changeServantMoney(event.player, amount)),
    "Withdraw coins", () => quantity(event.player, amount => changeServantMoney(event.player, -amount)), "Cancel", () => {});
  return true;
}
function quantity(player, action) {
  player.setEnteredSyntaxAction({ execute: text => {
    if (!/^\d+$/.test(text.trim())) return;
    const amount = Number(text);
    if (Number.isSafeInteger(amount) && amount > 0) action(amount);
  } });
  player.getPacketSender().sendEnterInputPrompt("Enter amount:");
}

function returnCargo(player) {
  const runtime = ownerContext(player), save = House.houseStateFor(player), def = definition(save);
  if (!runtime || runtime.due !== undefined || !save.servant?.cargo || !def) return;
  save.servant.cargo.bank = true;
  charge(save.servant, TAKE_BACK_COST);
  runtime.due = World.getProcessCycle() + def.ticks;
  removeNpc(runtime);
  persist(player);
}
function guestMenu(guest, runtime) {
  if (runtime.due !== undefined || (payLeft(runtime.house.save.servant) === 0 && !payFromMoneyBag(runtime.house.owner))) { guest.sendMessage("The servant is busy."); return; }
  api.sendMultiChatboxPrompt(guest, "How may I help you?", "Take me to the owner", () => guide(guest, runtime, false),
    "Show me the way out", () => guide(guest, runtime, true), "Nothing, thanks", () => {});
}
function guide(guest, runtime, outside) {
  if (guest.getPrivateArea() !== runtime.house || runtime.due !== undefined || runtime.guide || !runtime.npc || !runtime.house.owner
    || (payLeft(runtime.house.save.servant) === 0 && !payFromMoneyBag(runtime.house.owner)) || runtime.house.save.servant?.cargo) return;
  runtime.guide = { guest, outside };
  guest.setFollowing(runtime.npc);
  guest.sendMessage("Follow me, please.");
}
/** Back from an errand: the money bag pays a wage that is due, then the servant hands over what it brought. */
function returnFromErrand(player, runtime) {
  runtime.due = undefined;
  spawn(player, runtime);
  const servant = runtime.house.save.servant;
  // Ours: the bag also pays on the return from a bank errand (live shows it on a fetch).
  const paid = payFromMoneyBag(player);
  if (!servant?.cargo || servant.cargo.bank) { if (servant?.cargo) bankCargo(player); return; }
  if (!runtime.npc) return;
  if (!paid) { demandWage(player, runtime); return; }
  handOver(player, runtime);
}
function processServant(player) {
  const runtime = runtimes.get(player);
  if (!runtime) return;
  if (player.getPrivateArea() !== runtime.house || runtime.house.isDestroyed()) { leaveServantHouse(player, runtime.house); return; }
  if (!hasServantBeds(runtime.house.save)) {
    runtime.absent = true;
    removeNpc(runtime);
    if (runtime.house.save.servant?.cargo) bankCargo(player);
    runtime.due = undefined;
    return;
  }
  if (runtime.absent) return; // A replaced bed takes effect on the next house entry.
  const cycle = World.getProcessCycle();
  if (runtime.due !== undefined && cycle >= runtime.due) returnFromErrand(player, runtime);
  if (runtime.due !== undefined) return;
  if (runtime.meal && cycle >= runtime.meal.ready && runtime.npc) {
    const meal = runtime.meal;
    runtime.meal = undefined;
    if (meal.kind === "dinner") runtime.table = meal.itemId;
    else {
      runtime.npc.getMovementQueue().reset();
      runtime.npc.moveTo(player.getLocation().clone());
      offerMeal(player, runtime, meal);
    }
  }
  if (runtime.table) {
    // Dinner waits on the table until someone seated there has room for it.
    const diners = runtime.house.getPlayers().filter(p => {
      const pos = runtime.house.getRoomPositionAt(p.getLocation());
      return pos && runtime.house.getRoom(pos)?.roomKey === "DINING_ROOM" && House.isSeatedForDinner(p)
        && p.getInventory().getFreeSlots() > 0;
    });
    for (const diner of diners) diner.getInventory().adds(runtime.table, 1);
    if (diners.length) runtime.table = undefined;
  }
  const servant = runtime.house.save.servant;
  if (servant?.cargo && !servant.cargo.bank) runtime.npc?.setFollowing(player);
  if (runtime.guide && runtime.npc) {
    const { guest, outside } = runtime.guide;
    if (guest.getPrivateArea() !== runtime.house || guest.getFollowing() !== runtime.npc) { runtime.guide = undefined; return; }
    const target = outside ? runtime.house.getEntryLocation() : player.getLocation();
    if (runtime.npc.getLocation().getZ() !== target.getZ()) { guest.sendMessage("The owner is on another floor."); guest.setFollowing(null); runtime.guide = undefined; return; }
    if (runtime.npc.getLocation().getDistance(target) <= 1 && guest.getLocation().getDistance(runtime.npc.getLocation()) <= 2) {
      guest.setFollowing(null);
      runtime.guide = undefined;
      if (outside) runtime.house.exitHouse(guest, Estate.houseExit(runtime.house.save));
    } else if (cycle % 2 === 0 && runtime.npc.getLocation().getDistance(guest.getLocation()) < 6) PathFinder.calculateWalkRoute(runtime.npc, target.x, target.y);
  }
}
function talk(event) {
  const def = SERVANTS.find(s => s.id === event.npcId || s.id + 1 === event.npcId);
  if (!def && event.npcId !== Npcs.CHIEF_SERVANT) return false;
  if (!atNpc(event)) return true;
  const player = event.player, house = player.getPrivateArea();
  if (house instanceof Instance.PlayerHouseInstance) {
    const runtime = house.owner && runtimes.get(house.owner);
    if (runtime?.npc !== event.npc) return true;
    if (house.owner === player) { if (ownerContext(player) === runtime && runtime.due === undefined) ownerTalk(player, runtime); } else guestMenu(player, runtime);
  } else if (event.npcId === Npcs.CHIEF_SERVANT) chiefTalk(event);
  else guildTalk(event, def);
  return true;
}
function login({ player }) {
  const saved = player.getAttribute(Data.HOUSE_ATTRIBUTE);
  if (!saved?.servant) return;
  bankCargo(player);
  persist(player);
}

function attachServants(api) {
  api.onNpcFirstClick([...SERVANTS.flatMap(s => [s.id, s.id + 1]), Npcs.CHIEF_SERVANT], talk);
  api.onItemOnNpc(itemOnServant);
  api.onPlayerLogin(login);
}

Object.assign(module.exports, { SERVANTS, hasServantBeds, leaveServantHouse, enterServantHouse, callServant, callServantFromOptions, payServant, startServantTask, fireServant, changeServantMoney, useServantFurniture, processServant, attachServants, talk, itemOnServant });

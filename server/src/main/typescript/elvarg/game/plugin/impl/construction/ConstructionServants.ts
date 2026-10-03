import type { PluginApi, PluginNpcInteractionEvent, PluginItemOnNpcEvent, PluginObjectInteractionEvent } from "../../../../plugins/PluginTypes";
import { PluginManager } from "../../../../plugins/PluginManager";
import type { Player } from "../../../entity/impl/player/Player";
import type { NPC } from "../../../entity/impl/npc/NPC";
import { World } from "../../../World";
import { Item } from "../../../model/Item";
import { Skill } from "../../../model/Skill";
import { Bank } from "../../../model/container/impl/Bank";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { PathFinder } from "../../../model/movement/path/PathFinder";
import { NpcIdentifiers as Npcs } from "../../../../util/NpcIdentifiers";
import { ItemIdentifiers as Items } from "../../../../util/ItemIdentifiers";
import { DialogueChainBuilder } from "../../../model/dialogues/builders/DialogueChainBuilder";
import { NpcDialogue } from "../../../model/dialogues/entries/impl/NpcDialogue";
import { EndDialogue } from "../../../model/dialogues/entries/impl/EndDialogue";
import { PlayerHouseInstance, type PlayerHouseSave, type SavedHouseRoom } from "./PlayerHouseInstance";
import { houseStateFor, isSeatedForDinner } from "./ConstructionPlugin";
import { houseExit } from "./HouseEstateData";

// Guild NPCs are the following cache morphs; varbit 2190 hides the hired candidate.
export const SERVANTS = [
  { id: Npcs.RICK, type: 1, level: 20, wage: 500, capacity: 6, ticks: 100, food: Items.SHRIMPS },
  { id: Npcs.MAID, type: 3, level: 25, wage: 1000, capacity: 10, ticks: 50, food: Items.STEW },
  { id: Npcs.COOK, type: 5, level: 30, wage: 3000, capacity: 16, ticks: 29, food: Items.PINEAPPLE_PIZZA },
  { id: Npcs.BUTLER, type: 6, level: 40, wage: 5000, capacity: 20, ticks: 20, food: Items.CHOCOLATE_CAKE },
  { id: Npcs.DEMON_BUTLER, type: 8, level: 50, wage: 10000, capacity: 26, ticks: 12, food: Items.CURRY },
] as const;
type Task = { kind: "fetch" | "bank" | "unnote" | "sawmill"; itemId: number; amount: number; meta?: Record<string, unknown> | null };
export type SavedServant = {
  id: number;
  uses: number;
  lastTask?: Task;
  cargo?: { itemId: number; amount: number; bank: boolean; meta?: Record<string, unknown> | null };
  greet?: boolean;
};
type Runtime = {
  house: PlayerHouseInstance;
  npc?: NPC;
  due?: number;
  absent?: boolean;
  guide?: { guest: Player; outside: boolean };
  meal?: { itemId: number; kind: "tea" | "dinner" | "drinks" };
};
const runtimes = new WeakMap<Player, Runtime>();
const MATERIALS = [Items.PLANK, Items.OAK_PLANK, Items.TEAK_PLANK, Items.MAHOGANY_PLANK,
  Items.SOFT_CLAY, Items.LIMESTONE_BRICK, Items.STEEL_BAR, Items.BOLT_OF_CLOTH,
  Items.GOLD_LEAF, Items.MARBLE_BLOCK, Items.MAGIC_STONE];
const SAWMILL = new Map([
  [Items.LOGS, [Items.PLANK, 100]], [Items.OAK_LOGS, [Items.OAK_PLANK, 250]],
  [Items.TEAK_LOGS, [Items.TEAK_PLANK, 500]], [Items.MAHOGANY_LOGS, [Items.MAHOGANY_PLANK, 1500]],
  [Items.CAMPHOR_LOGS, [Items.CAMPHOR_PLANK, 2500]], [Items.IRONWOOD_LOGS, [Items.IRONWOOD_PLANK, 5000]],
  [Items.ROSEWOOD_LOGS, [Items.ROSEWOOD_PLANK, 7500]],
]);
const TEAS = [Items.CUP_OF_TEA_9, Items.CUP_OF_TEA_11, Items.CUP_OF_TEA_13];
const DRINKS: Record<string, number> = { BEER_BARREL: Items.BEER_3, CIDER_BARREL: Items.CIDER_3,
  ASGARNIAN_ALE_BARREL: Items.ASGARNIAN_ALE_3, GREENMANS_ALE_BARREL: Items.GREENMANS_ALE_3,
  DRAGON_BITTER_BARREL: Items.DRAGON_BITTER_3, CHEFS_DELIGHT_BARREL: Items.CHEFS_DELIGHT_3 };
const HOUSE_ITEMS = [...TEAS.flatMap(id => [id, id + 1]), Items.EMPTY_CUP_3,
  Items.PORCELAIN_CUP_2, Items.PORCELAIN_CUP_3, Items.BEER_GLASS_4, ...Object.values(DRINKS)];

function keys(room: SavedHouseRoom): string[] {
  return [...Object.values(room.furniture), ...Object.values(room.furnitureByLocation ?? {}).map(f => f.buildableKey)];
}
function rooms(save: PlayerHouseSave): SavedHouseRoom[] { return save.rooms.flat(2).filter((r): r is SavedHouseRoom => !!r); }
function has(save: PlayerHouseSave, key: string): boolean { return rooms(save).some(r => keys(r).includes(key)); }
export function hasServantBeds(save: PlayerHouseSave): boolean {
  return rooms(save).filter(r => r.roomKey === "BEDROOM" && keys(r).some(k => k.endsWith("_BED"))).length >= 2;
}
function definition(save: PlayerHouseSave) { return SERVANTS.find(s => s.id === save.servant?.id); }
function persist(player: Player): void {
  const save = houseStateFor(player);
  player.setAttribute("construction:house", save);
  player.getPacketSender().sendVarbit(2190, definition(save)?.type ?? 0);
  player.getPacketSender().sendVarbit(2191, save.servant?.uses ?? 0);
}
function say(player: Player, id: number, text: string): void {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, id, text), new EndDialogue(1)));
}
function ownerContext(player: Player): Runtime | undefined {
  const runtime = runtimes.get(player);
  return runtime && !runtime.absent && runtime.house.owner === player && player.getPrivateArea() === runtime.house
    && !runtime.house.isDestroyed() && hasServantBeds(runtime.house.save) && definition(runtime.house.save) ? runtime : undefined;
}
function removeNpc(runtime: Runtime): void {
  if (!runtime.npc) return;
  const npc = runtime.npc;
  runtime.npc = undefined;
  if (runtime.guide?.guest.getFollowing() === npc) runtime.guide.guest.setFollowing(null);
  runtime.guide = undefined;
  runtime.house.leave(npc, false);
  PluginManager.removeNpc(npc);
}
function spawn(player: Player, runtime: Runtime, location = player.getLocation()): void {
  if (runtime.npc || runtime.absent || runtime.due !== undefined || !definition(runtime.house.save)) return;
  const npc = PluginManager.spawnNpc({ id: runtime.house.save.servant!.id, x: location.x, y: location.y, z: location.z, wanderRadius: 0 });
  if (!npc) return;
  runtime.npc = npc;
  runtime.house.enter(npc);
}
function cargoBank(player: Player, id: number, meta?: Record<string, unknown> | null): Bank | undefined {
  const banks = player.getBanks().slice(0, Bank.BANK_SEARCH_TAB_INDEX).filter(Boolean);
  return banks.find(bank => bank.getItems().some(item => item.getId() === id
    && JSON.stringify(item.getMeta() ?? null) === JSON.stringify(meta ?? null)))
    ?? banks.find(bank => bank.getFreeSlots() > 0);
}
function bankCargo(player: Player): boolean {
  const cargo = houseStateFor(player).servant?.cargo;
  if (!cargo) return true;
  const bank = cargoBank(player, cargo.itemId, cargo.meta);
  if (!bank) return false;
  const before = bank.getAmount(cargo.itemId);
  const amount = Math.min(cargo.amount, Number.MAX_SAFE_INTEGER - before);
  if (amount > 0 && (bank.contains(cargo.itemId) || bank.getFreeSlots() > 0)) {
    bank.add(new Item(cargo.itemId, amount, cargo.meta), false);
    cargo.amount -= bank.getAmount(cargo.itemId) - before;
  }
  if (!cargo.amount) delete houseStateFor(player).servant!.cargo;
  persist(player);
  return cargo.amount === 0;
}

/** Also called by the instance leave hook: teleporting and disconnecting cannot strand cargo. */
export function leaveServantHouse(player: Player, house: PlayerHouseInstance): void {
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
export function enterServantHouse(player: Player, house: PlayerHouseInstance): void {
  if (house.owner !== player) {
    const runtime = house.owner && runtimes.get(house.owner);
    if (runtime?.npc && house.save.servant?.greet) runtime.npc.forceChat(`Welcome to ${house.owner!.getUsername()}'s house!`);
    return;
  }
  if (!definition(house.save)) return;
  const old = runtimes.get(player);
  if (old?.house === house) return;
  const runtime: Runtime = { house, absent: !hasServantBeds(house.save) };
  runtimes.set(player, runtime);
  spawn(player, runtime);
}
export function callServant(player: Player): void {
  const runtime = ownerContext(player);
  if (!runtime) { player.sendMessage("You need a hired servant and two bedrooms with beds in your own house."); return; }
  if (!rooms(runtime.house.save).some(r => keys(r).some(k => k.endsWith("BELL_PULL")))) {
    player.sendMessage("You need a bell-pull in your dining room to call your servant."); return;
  }
  if (runtime.due !== undefined) { player.sendMessage("Your servant is still carrying out your request."); return; }
  spawn(player, runtime);
  runtime.npc?.getMovementQueue().reset();
  runtime.npc?.moveTo(player.getLocation().clone());
  runtime.npc?.forceChat("You rang?");
}
export function payServant(player: Player, automatic = false): boolean {
  const save = houseStateFor(player), servant = save.servant, def = definition(save);
  if (!def || !servant) return false;
  if (servant.uses < 8) return true;
  if (has(save, "SERVANTS_MONEYBAG") && (save.servantMoney ?? 0) >= def.wage) save.servantMoney! -= def.wage;
  else {
    if (automatic) return false;
    if (player.getInventory().getAmount(Items.COINS) < def.wage) { player.sendMessage(`Your servant needs ${def.wage} coins.`); return false; }
    player.getInventory().delete(Items.COINS, def.wage);
  }
  servant.uses = 0;
  persist(player);
  return true;
}
function deliver(player: Player): void {
  const runtime = ownerContext(player), servant = houseStateFor(player).servant;
  if (!runtime || runtime.due !== undefined || !servant?.cargo) return;
  if (!payServant(player, true)) return;
  const cargo = servant.cargo;
  if (cargo.bank) { bankCargo(player); return; }
  const inventory = player.getInventory(), before = inventory.getAmount(cargo.itemId);
  const stackable = ItemDefinition.forId(cargo.itemId).isStackable();
  const space = stackable ? (inventory.contains(cargo.itemId) || inventory.getFreeSlots() > 0 ? Number.MAX_SAFE_INTEGER - before : 0) : inventory.getFreeSlots();
  const amount = Math.min(cargo.amount, space);
  if (amount > 0) inventory.adds(cargo.itemId, amount);
  cargo.amount -= inventory.getAmount(cargo.itemId) - before;
  if (!cargo.amount) delete servant.cargo;
  persist(player);
  runtime.npc?.setFollowing(servant.cargo ? player : null);
}
export function startServantTask(player: Player, task: Task): boolean {
  const runtime = ownerContext(player), save = houseStateFor(player), servant = save.servant, def = definition(save);
  if (!runtime || !servant || !def || runtime.due !== undefined || runtime.guide || runtime.meal) return false;
  if (!Number.isSafeInteger(task.amount) || task.amount < 1 || !Number.isSafeInteger(task.itemId) || task.itemId < 1) return false;
  if (!payServant(player, true)) { player.sendMessage("You must pay your servant before asking for more work."); return false; }
  if (servant.cargo) { player.sendMessage("Collect the items your servant is already holding first."); return false; }
  if (PluginManager.emitCanBank(player) === false) return false;
  const inventory = player.getInventory(), input = ItemDefinition.forId(task.itemId);
  const id = input.unNote(), item = new Item(task.itemId, task.amount, task.meta);
  if (HOUSE_ITEMS.includes(id) || /\bbones\b/i.test(ItemDefinition.forId(id).getName()) || item.isUnbankable() || PluginManager.emitCanBankItem(player, item) === false) {
    player.sendMessage("Your servant cannot carry that item."); return false;
  }
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
  if (amount <= 0) { player.sendMessage("You do not have the items or coins needed for that request."); return false; }
  if (task.kind === "bank") {
    const bank = cargoBank(player, id, task.meta);
    if (!bank || !Number.isSafeInteger(bank.getAmount(id) + amount)) {
      player.sendMessage("There is not enough room in your bank."); return false;
    }
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
  servant.uses++;
  runtime.due = World.getProcessCycle() + def.ticks;
  removeNpc(runtime);
  persist(player);
  return true;
}

export function fireServant(player: Player): boolean {
  const save = houseStateFor(player);
  if (!definition(save)) return false;
  if (!bankCargo(player)) { player.sendMessage("Make room in your bank for the items your servant is holding before dismissing them."); return false; }
  const runtime = runtimes.get(player);
  if (runtime) { removeNpc(runtime); runtimes.delete(player); }
  delete save.servant;
  persist(player);
  return true;
}
function atNpc(event: PluginNpcInteractionEvent): boolean {
  return event.npc.getPrivateArea() === event.player.getPrivateArea() && event.player.getLocation().getZ() === event.npc.getLocation().getZ()
    && event.player.getLocation().getDistance(event.npc.getLocation()) <= 6;
}
function hire(event: PluginNpcInteractionEvent): void {
  const player: Player = event.player, save = houseStateFor(player);
  const def = SERVANTS.find(s => s.id === event.npcId || s.id + 1 === event.npcId);
  if (!def || !atNpc(event) || player.getPrivateArea()) return;
  const problem = save.owned === false ? "You must own a house first." : definition(save) ? "You already have a servant."
    : player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < def.level ? `You need level ${def.level} Construction.`
    : !hasServantBeds(save) ? "You need two bedrooms, each with a bed." : player.getInventory().getAmount(Items.COINS) < def.wage ? `You need ${def.wage} coins to hire me.` : null;
  if (problem) { say(player, def.id, problem); return; }
  player.getInventory().delete(Items.COINS, def.wage);
  save.servant = { id: def.id, uses: 0 };
  persist(player);
  say(player, def.id, "Thank you. I will meet you at your house.");
}
function quantity(player: Player, action: (amount: number) => void): void {
  player.setEnteredSyntaxAction({ execute: text => {
    if (!/^\d+$/.test(text.trim())) return;
    const amount = Number(text);
    if (Number.isSafeInteger(amount) && amount > 0) action(amount);
  } });
  player.getPacketSender().sendEnterInputPrompt("Enter amount:");
}
function fetchMenu(api: PluginApi, player: Player, page = 0): void {
  const options: Array<string | (() => void)> = [];
  for (const id of MATERIALS.slice(page * 4, page * 4 + 4)) options.push(ItemDefinition.forId(id).getName(), () => quantity(player, amount => startServantTask(player, { kind: "fetch", itemId: id, amount })));
  if ((page + 1) * 4 < MATERIALS.length) options.push("More...", () => fetchMenu(api, player, page + 1));
  api.sendMultiChatboxPrompt(player, "Bring something from the bank", ...options);
}
function confirmFire(api: PluginApi, event: PluginNpcInteractionEvent): void {
  api.sendMultiChatboxPrompt(event.player, "Do you really want to fire your servant?", "Yes", () => { if (atNpc(event)) fireServant(event.player); }, "No", () => {});
}
function bankMenu(api: PluginApi, player: Player): void {
  api.sendMultiChatboxPrompt(player, "Go to the bank...", "Bring something from the bank", () => fetchMenu(api, player),
    "Take something to the bank", () => player.sendMessage("Use the item on your servant to have it taken to the bank."));
}
function returnCargo(player: Player): void {
  const runtime = ownerContext(player), save = houseStateFor(player), def = definition(save);
  if (!runtime || runtime.due !== undefined || !save.servant?.cargo || !def || !payServant(player, true)) return;
  save.servant.cargo.bank = true;
  save.servant.uses++;
  runtime.due = World.getProcessCycle() + def.ticks;
  removeNpc(runtime);
  persist(player);
}
function ownerMenu(api: PluginApi, event: PluginNpcInteractionEvent): void {
  const player: Player = event.player, runtime = ownerContext(player), servant = houseStateFor(player).servant;
  if (!runtime || runtime.npc !== event.npc || runtime.due !== undefined || !servant) return;
  if (!payServant(player, true)) {
    api.sendMultiChatboxPrompt(player, `Your servant requires ${definition(runtime.house.save)!.wage} coins.`,
      "Pay", () => { if (ownerContext(player)?.npc === event.npc && payServant(player)) deliver(player); },
      "I'll pay you later", () => {}, "You're fired!", () => confirmFire(api, event));
    return;
  }
  if (servant.cargo) {
    api.sendMultiChatboxPrompt(player, "Your servant is holding your items.", "Receive items", () => deliver(player),
      "Take them to the bank", () => returnCargo(player), "You're fired!", () => confirmFire(api, event));
    return;
  }
  if (runtime.meal || runtime.guide) {
    api.sendMultiChatboxPrompt(player, "Your servant is serving your household.", "Stop serving", () => {
      if (!ownerContext(player)) return;
      runtime.meal = undefined;
      if (runtime.guide?.guest.getFollowing() === runtime.npc) runtime.guide.guest.setFollowing(null);
      runtime.guide = undefined;
    }, "You're fired!", () => confirmFire(api, event));
    return;
  }
  const options: Array<string | (() => void)> = [];
  const last = servant.lastTask;
  const logs = last?.kind === "unnote" ? ItemDefinition.forId(last.itemId).unNote() : -1;
  if (last && SAWMILL.has(logs) && definition(runtime.house.save)!.level >= 30) {
    options.push("Take those logs to the sawmill", () => startServantTask(player, { kind: "sawmill", itemId: logs, amount: last.amount }));
  } else if (last) options.push("Repeat last task", () => startServantTask(player, last));
  options.push("Serve...", () => serveMenu(api, player), "Go to the bank...", () => bankMenu(api, player),
    "Go to the sawmill...", () => player.sendMessage(definition(runtime.house.save)!.level >= 30 ? "Use your logs on your servant." : "This servant cannot visit the sawmill."),
    "More...", () => api.sendMultiChatboxPrompt(player, "Select an option", "Greet guests", () => {
      if (!ownerContext(player)) return;
      servant.greet = true;
      runtime.npc?.setFollowing(null);
      runtime.npc?.moveTo(runtime.house.getEntryLocation());
      persist(player);
    }, "You're fired!", () => confirmFire(api, event)));
  api.sendMultiChatboxPrompt(player, "How may I help you?", ...options);
}
function talk(api: PluginApi, event: PluginNpcInteractionEvent): boolean {
  const def = SERVANTS.find(s => s.id === event.npcId || s.id + 1 === event.npcId);
  if (!def && event.npcId !== Npcs.CHIEF_SERVANT) return false;
  if (!atNpc(event)) return true;
  const player: Player = event.player, house = player.getPrivateArea();
  if (house instanceof PlayerHouseInstance) {
    const runtime = house.owner && runtimes.get(house.owner);
    if (runtime?.npc !== event.npc) return true;
    if (house.owner === player) ownerMenu(api, event);
    else guestMenu(api, player, runtime);
  } else if (event.npcId === Npcs.CHIEF_SERVANT) {
    api.sendMultiChatboxPrompt(player, "Servants' Guild", "Tell me about servants", () => say(player, event.npcId,
      "Our servants can fetch supplies, take items to the bank, greet guests and serve refreshments. Build two bedrooms with beds, then speak to the servant you wish to hire. More experienced servants carry more and travel faster."),
      "Fire my servant", () => confirmFire(api, event), "Nothing, thanks", () => {});
  } else {
    api.sendMultiChatboxPrompt(player, `Hire for ${def!.wage} coins?`, "You're hired!", () => hire(event),
      "What can you do?", () => say(player, def!.id, `I carry ${def!.capacity} items and need ${def!.ticks * 0.6} seconds for a trip. My wage is ${def!.wage} coins for eight services.${def!.level >= 30 ? " I can also visit the sawmill." : " I cannot visit the sawmill."}`), "No, thanks", () => {});
  }
  return true;
}
function itemOnServant(api: PluginApi, event: PluginItemOnNpcEvent): void {
  const player: Player = event.player, runtime = ownerContext(player);
  if (!runtime || event.target !== runtime.npc) return;
  event.handled = true;
  const item = player.getInventory().getItems()[event.slot];
  if (!item || item.getId() !== event.itemId) return;
  const input = item.getDefinition();
  const options: Array<string | (() => void)> = [];
  const meta = Item.cloneMeta(item.getMeta());
  if (input.isNoted()) options.push("Un-note", () => quantity(player, amount => startServantTask(player, { kind: "unnote", itemId: event.itemId, amount, meta })));
  else if (SAWMILL.has(event.itemId) && definition(runtime.house.save)!.level >= 30) options.push("Take to sawmill", () => quantity(player, amount => startServantTask(player, { kind: "sawmill", itemId: event.itemId, amount, meta })));
  options.push("Take to bank", () => quantity(player, amount => startServantTask(player, { kind: "bank", itemId: event.itemId, amount, meta })), "Cancel", () => {});
  api.sendMultiChatboxPrompt(player, "What would you like me to do?", ...options);
}

export function changeServantMoney(player: Player, amount: number): boolean {
  const house = player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance) || house.owner !== player || !has(house.save, "SERVANTS_MONEYBAG") || !Number.isSafeInteger(amount)) return false;
  const inventory = player.getInventory(), balance = house.save.servantMoney ?? 0;
  if (amount > 0) {
    amount = Math.floor(Math.min(amount, inventory.getAmount(Items.COINS), 3000000 - balance) / 100) * 100;
    if (!amount) return false;
    inventory.delete(Items.COINS, amount);
    house.save.servantMoney = balance + amount;
  } else {
    if (PluginManager.emitCanBank(player) === false) return false;
    amount = Math.min(-amount, balance);
    if (!amount || (!inventory.contains(Items.COINS) && !inventory.getFreeSlots()) || !Number.isSafeInteger(inventory.getAmount(Items.COINS) + amount)) return false;
    inventory.adds(Items.COINS, amount);
    house.save.servantMoney = balance - amount;
  }
  persist(player);
  player.sendMessage(`Your servant's money bag contains ${house.save.servantMoney} coins.`);
  return true;
}
export function useServantFurniture(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  const house = event.player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance)) return false;
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

function serveMenu(api: PluginApi, player: Player): void {
  api.sendMultiChatboxPrompt(player, "Serve...", "Tea", () => api.sendMultiChatboxPrompt(player, "Would you like milk?",
    "Yes, please", () => prepareMeal(player, "tea", true), "No, thanks", () => prepareMeal(player, "tea", false)),
    "Dinner", () => prepareMeal(player, "dinner"), "Drinks", () => prepareMeal(player, "drinks"));
}
function prepareMeal(player: Player, kind: "tea" | "dinner" | "drinks", milk = false): void {
  const runtime = ownerContext(player), save = houseStateFor(player), servant = save.servant, def = definition(save);
  if (!runtime || !servant || !def || runtime.due !== undefined || runtime.meal || servant.cargo || runtime.guide || !payServant(player, true)) return;
  const kitchen = rooms(save).find(r => r.roomKey === "KITCHEN" && (kind === "drinks" ? keys(r).some(k => DRINKS[k])
    : keys(r).some(k => k.includes("LARDER")) && keys(r).some(k => /SHELVES/.test(k))
      && keys(r).some(k => /OVEN|RANGE|FIREPIT_WITH/.test(k)) && (kind !== "tea" || keys(r).some(k => /SINK|PUMP/.test(k)))));
  if (!kitchen || (kind === "dinner" && !rooms(save).some(r => r.roomKey === "DINING_ROOM" && keys(r).some(k => /TABLE/.test(k))))) {
    player.sendMessage("Your servant needs a furnished kitchen, and a dining table for dinner."); return;
  }
  const built = keys(kitchen);
  const tier = built.includes("TEAK_SHELVES_2") ? 2 : built.some(k => ["WOODEN_SHELVES_3", "OAK_SHELVES_2", "TEAK_SHELVES_1"].includes(k)) ? 1 : 0;
  const itemId = kind === "tea" ? TEAS[tier] + (milk ? 1 : 0) : kind === "dinner" ? def.food : DRINKS[built.find(k => DRINKS[k])!];
  runtime.meal = { kind, itemId };
  runtime.due = World.getProcessCycle() + def.ticks;
  servant.uses++;
  persist(player);
}
function guestMenu(api: PluginApi, guest: Player, runtime: Runtime): void {
  const owner = runtime.house.owner!;
  if (runtime.due !== undefined || !payServant(owner, true)) { guest.sendMessage("The servant is busy."); return; }
  api.sendMultiChatboxPrompt(guest, "How may I help you?", "Take me to the owner", () => guide(guest, runtime, false),
    "Show me the way out", () => guide(guest, runtime, true), "Nothing, thanks", () => {});
}
function guide(guest: Player, runtime: Runtime, outside: boolean): void {
  if (guest.getPrivateArea() !== runtime.house || runtime.due !== undefined || runtime.guide || !runtime.npc || !runtime.house.owner
    || !payServant(runtime.house.owner, true) || runtime.house.save.servant?.cargo) return;
  runtime.guide = { guest, outside };
  guest.setFollowing(runtime.npc);
  guest.sendMessage("Follow me, please.");
}
export function processServant(player: Player): void {
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
  if (runtime.due !== undefined && cycle >= runtime.due) {
    runtime.due = undefined;
    spawn(player, runtime);
    if (runtime.house.save.servant?.cargo) {
      deliver(player);
      if (!payServant(player, true)) player.sendMessage("Your servant has returned and requires payment.");
    }
  }
  if (runtime.due !== undefined) return;
  if (runtime.meal && payServant(player, true)) {
    const meal = runtime.meal;
    const recipients = meal.kind === "tea" ? [player] : meal.kind === "drinks" ? runtime.house.getPlayers() : runtime.house.getPlayers().filter(p => {
      const pos = runtime.house.getRoomPositionAt(p.getLocation());
      return pos && runtime.house.getRoom(pos)?.roomKey === "DINING_ROOM" && isSeatedForDinner(p);
    });
    const served = recipients.filter(recipient => recipient.getInventory().getFreeSlots() > 0);
    for (const recipient of served) recipient.getInventory().adds(meal.itemId, 1);
    if (served.length) runtime.meal = undefined;
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
      if (outside) runtime.house.exitHouse(guest, houseExit(runtime.house.save));
    } else if (cycle % 2 === 0 && runtime.npc.getLocation().getDistance(guest.getLocation()) < 6) PathFinder.calculateWalkRoute(runtime.npc, target.x, target.y);
  }
}
function login({ player }: { player: Player }): void {
  const saved = player.getAttribute("construction:house") as PlayerHouseSave | undefined;
  if (!saved?.servant) return;
  bankCargo(player);
  persist(player);
}
export const ConstructionServants = {
  register(api: PluginApi): void {
    api.onNpcFirstClick([...SERVANTS.flatMap(s => [s.id, s.id + 1]), Npcs.CHIEF_SERVANT], talk.bind(null, api));
    api.onItemOnNpc(itemOnServant.bind(null, api));
    api.onPlayerLogin(login);
  },
};

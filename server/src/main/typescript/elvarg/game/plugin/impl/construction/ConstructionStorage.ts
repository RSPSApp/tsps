import type { PluginApi, PluginObjectInteractionEvent, PluginItemOnObjectEvent } from "../../../../plugins/PluginTypes";
import type { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../../model/Item";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { CachePipeline } from "../../../cache/CachePipeline";
import { CacheIndexDat2 } from "../../../cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../../../cache/codec/rs/cache/IndexType";
import { ConfigType } from "../../../cache/codec/rs/cache/ConfigType";
import { ByteBuffer } from "../../../cache/codec/rs/io/ByteBuffer";
import { PlayerHouseInstance, type SavedHouseFurniture } from "./PlayerHouseInstance";

// Native costume-room enums: set representatives, set members, and alternatives.
const STORAGE_ENUMS: Record<string, number[]> = {
  MAGIC_WARDROBE: [3289], ARMOUR_CASE: [3290], FANCY_DRESS_BOX: [3291],
  CAPE_RACK: [3292], TREASURE_CHEST: [3293, 3294, 3295, 3296, 3297, 3298], TOY_BOX: [3299],
};
let enumArchive: ReturnType<CacheIndexDat2["getArchive"]>;
const enumCache = new Map<number, Map<number, number>>();
function numericEnum(id: number): Map<number, number> {
  const cached = enumCache.get(id);
  if (cached) return cached;
  enumArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore()).getArchive(ConfigType.DAT2.enums);
  const file = enumArchive.getFile(id);
  if (!file) throw new Error(`Missing costume storage enum ${id}`);
  const buffer = new ByteBuffer(new Int8Array(file.data));
  const entries = new Map<number, number>();
  for (let opcode = buffer.readUnsignedByte(); opcode; opcode = buffer.readUnsignedByte()) {
    if (opcode === 1 || opcode === 2) buffer.readUnsignedByte();
    else if (opcode === 3) buffer.readString();
    else if (opcode === 4) buffer.readInt();
    else if (opcode === 6 || opcode === 8) {
      if (opcode === 8) buffer.readUnsignedShort();
      const count = buffer.readUnsignedShort();
      for (let i = 0; i < count; i++) entries.set(opcode === 8 ? buffer.readUnsignedShort() : buffer.readInt(), buffer.readInt());
    } else throw new Error(`Non-numeric costume enum ${id}: opcode ${opcode}`);
  }
  enumCache.set(id, entries);
  return entries;
}

export function storageItems(furniture: SavedHouseFurniture): Map<number, number> {
  const result = new Map<number, number>();
  let enums = STORAGE_ENUMS[furniture.hotspotKey];
  if (!enums) return result;
  if (furniture.hotspotKey === "TREASURE_CHEST") enums = enums.slice(0, furniture.buildableKey.startsWith("OAK") ? 2 : furniture.buildableKey.startsWith("TEAK") ? 3 : 6);
  const members = numericEnum(3077), alternates = numericEnum(3303), alternateSets = numericEnum(3304);
  for (const enumId of enums) for (const representative of numericEnum(enumId).values()) {
    const set = members.has(representative) ? [...numericEnum(members.get(representative)!).values()] : [representative];
    for (const id of set) {
      result.set(id, representative);
      if (alternates.has(id)) result.set(alternates.get(id)!, representative);
      if (alternateSets.has(id)) for (const alternate of numericEnum(alternateSets.get(id)!).values()) result.set(alternate, representative);
    }
  }
  return result;
}

function capacity(furniture: SavedHouseFurniture): number {
  const key = furniture.buildableKey;
  if (furniture.hotspotKey === "ARMOUR_CASE") return key.startsWith("OAK") ? 25 : key.startsWith("TEAK") ? 50 : Infinity;
  if (furniture.hotspotKey === "MAGIC_WARDROBE") return ({ OAK_MAGIC_WARDROBE: 7, CARVED_OAK_MAGIC_WARDROBE: 14, TEAK_MAGIC_WARDROBE: 21, CARVED_TEAK_MAGIC_WARDROBE: 28, MAHOGANY_MAGIC_WARDROBE: 35, GILDED_MAGIC_WARDROBE: 42 } as Record<string, number>)[key] ?? Infinity;
  if (furniture.hotspotKey === "CAPE_RACK") return ({ OAK_CAPE_RACK: 0, TEAK_CAPE_RACK: 1, MAHOGANY_CAPE_RACK: 5, GILDED_CAPE_RACK: 10, MARBLE_CAPE_RACK: Infinity } as Record<string, number>)[key] ?? Infinity;
  if (furniture.hotspotKey === "FANCY_DRESS_BOX") return key.startsWith("OAK") ? 2 : key.startsWith("TEAK") ? 4 : Infinity;
  return Infinity;
}

function currentFurniture(event: PluginObjectInteractionEvent | PluginItemOnObjectEvent): { house: PlayerHouseInstance; furniture: SavedHouseFurniture } | null {
  const house = event.player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance)) return null;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture && STORAGE_ENUMS[furniture.hotspotKey] ? { house, furniture } : null;
}

export function depositHouseItem(player: Player, house: PlayerHouseInstance, furniture: SavedHouseFurniture, slot: number): boolean {
  if (house.owner !== player || player.getPrivateArea() !== house || !house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture))) return false;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() <= 0 || item.getAmount() < 1 || item.getMeta()) return false;
  const allowed = storageItems(furniture), set = allowed.get(item.getId());
  if (set == null) return false;
  const stored = furniture.storage ??= {};
  const countsTowardLimit = (representative: number) => furniture.hotspotKey !== "CAPE_RACK"
    || (numericEnum(3077).has(representative) && [...numericEnum(numericEnum(3077).get(representative)!).values()].some(id => ItemDefinition.forId(id).getName().toLowerCase().includes("hood")));
  const used = new Set(Object.keys(stored).filter(id => stored[Number(id)] > 0).map(id => allowed.get(Number(id))).filter(id => id != null && countsTowardLimit(id)));
  if (countsTowardLimit(set) && !used.has(set) && used.size >= capacity(furniture)) { player.sendMessage("Upgrade this furniture to store more sets."); return false; }
  const amount = item.getAmount();
  if (!Number.isSafeInteger((stored[item.getId()] ?? 0) + amount)) return false;
  const id = item.getId();
  inventory.deleteAtSlot(slot, amount);
  stored[id] = (stored[id] ?? 0) + amount;
  player.setAttribute("construction:house", house.save);
  return true;
}

export function withdrawHouseItem(player: Player, house: PlayerHouseInstance, furniture: SavedHouseFurniture, id: number): boolean {
  if (house.owner !== player || player.getPrivateArea() !== house || !house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture))) return false;
  const stored = furniture.storage;
  if (!stored || !(stored[id] > 0)) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() === 0 && !(ItemDefinition.forId(id).isStackable() && inventory.contains(id))) { player.sendMessage("Not enough space in your inventory."); return false; }
  const before = inventory.getAmount(id);
  inventory.addItem(new Item(id, 1));
  if (inventory.getAmount(id) !== before + 1) return false;
  if (--stored[id] === 0) delete stored[id];
  player.setAttribute("construction:house", house.save);
  return true;
}

function listStorage(api: PluginApi, event: PluginObjectInteractionEvent, page = 0): void {
  const context = currentFurniture(event);
  if (!context) return;
  const { house, furniture } = context;
  const entries = Object.entries(furniture.storage ?? {}).filter(([, amount]) => amount > 0);
  if (!entries.length) { event.player.sendMessage("This storage is empty."); return; }
  const options: Array<string | (() => void)> = [];
  for (const [id, amount] of entries.slice(page * 4, page * 4 + 4)) options.push(`${ItemDefinition.forId(Number(id)).getName()} x${amount}`, () => {
    if (house.owner !== event.player) { event.player.sendMessage("Only the owner can withdraw stored items."); return; }
    withdrawHouseItem(event.player, house, furniture, Number(id));
    listStorage(api, event, page);
  });
  if ((page + 1) * 4 < entries.length) options.push("More items", () => listStorage(api, event, page + 1));
  api.sendMultiChatboxPrompt(event.player, house.owner === event.player ? "Withdraw an item" : "View stored items", ...options);
}

export function openHouseStorage(api: PluginApi, event: PluginObjectInteractionEvent): boolean {
  const context = currentFurniture(event);
  if (!context) return false;
  const { house, furniture } = context;
  if (house.owner !== event.player) { listStorage(api, event); return true; }
  api.sendMultiChatboxPrompt(event.player, "Costume storage", "Deposit inventory", () => {
    for (let slot = 0; slot < 28; slot++) depositHouseItem(event.player, house, furniture, slot);
    event.player.sendMessage("Stored eligible costume items. Use an item on the furniture to deposit it individually.");
  }, "Withdraw items", () => listStorage(api, event), "Cancel", () => {});
  return true;
}

export function storeItemOnFurniture(event: PluginItemOnObjectEvent): boolean {
  const context = currentFurniture(event);
  if (!context) return false;
  if (!depositHouseItem(event.player, context.house, context.furniture, event.itemSlot)) event.player.sendMessage("You cannot store that item here.");
  return true;
}

import type { PluginItemOnObjectEvent, PluginObjectInteractionEvent } from "../../../../plugins/PluginTypes";
import { Animation } from "../../../model/Animation";
import { Skill } from "../../../model/Skill";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { BONE_XP } from "../../../content/combat/magic/ArceuusOfferings";
import { PlayerHouseInstance } from "./PlayerHouseInstance";

const ALTAR_BONUS: Record<string, number> = { OAK_ALTAR: 1, TEAK_ALTAR: 1.1, CLOTH_ALTAR: 1.25, MAHOGANY_ALTAR: 1.5, LIMESTONE_ALTAR: 1.75, MARBLE_ALTAR: 2, GILDED_ALTAR: 2.5 };
const BURNERS = new Set(["INCENSE_BURNER", "MAHOGANY_BURNER", "MARBLE_BURNER"]);

export function lightHouseBurner(event: PluginObjectInteractionEvent | PluginItemOnObjectEvent): boolean {
  const { player } = event;
  const house = player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture || !BURNERS.has(furniture.buildableKey)) return false;
  const level = player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
  if (level < 30) { player.sendMessage("You need Firemaking level 30 to light incense."); return true; }
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.TINDERBOX) || !inventory.contains(ItemIdentifiers.MARRENTILL)) { player.sendMessage("You need a tinderbox and a clean marrentill herb."); return true; }
  if (!player.getClickDelay().elapsedTime(1200)) return true;
  inventory.delete(ItemIdentifiers.MARRENTILL, 1);
  house.litBurners.set(furniture, Date.now() + (200 + level + Math.floor(Math.random() * level)) * 600);
  player.performAnimation(new Animation(3687));
  player.getSkillManager().addExperiences(Skill.FIREMAKING, 50);
  player.getClickDelay().reset();
  house.redrawFurniture();
  return true;
}

export function expireHouseBurners(house: PlayerHouseInstance, now = Date.now()): void {
  let changed = false;
  for (const [furniture, until] of house.litBurners) if (until <= now) {
    house.litBurners.delete(furniture);
    changed = true;
  }
  if (changed) house.redrawFurniture();
}

export function offerHouseBones(event: PluginItemOnObjectEvent): boolean {
  const { player } = event;
  const house = player.getPrivateArea();
  if (!(house instanceof PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const multiplier = furniture && ALTAR_BONUS[furniture.buildableKey];
  const xp = BONE_XP.get(event.itemId);
  if (!multiplier || !xp) return false;
  if (!player.getClickDelay().elapsedTime(1800)) return true;
  const inventory = player.getInventory();
  if (inventory.getItems()[event.itemSlot]?.getId() !== event.itemId || inventory.getAmount(event.itemId) < 1) return true;
  const room = house.getRoom(house.getRoomPositionAt(event.location)!);
  const lit = Object.values(room?.furnitureByLocation ?? {}).filter(value => BURNERS.has(value.buildableKey) && (house.litBurners.get(value) ?? 0) > Date.now()).length;
  inventory.delete(event.itemId, 1);
  player.performAnimation(new Animation(3705));
  player.getSkillManager().addExperiences(Skill.PRAYER, xp * (multiplier + Math.min(2, lit) * 0.5));
  player.getClickDelay().reset();
  return true;
}

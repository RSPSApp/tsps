import { Location } from "../../../model/Location";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import type { PlayerHouseSave } from "./PlayerHouseInstance";

// Location keys are the native POH_HOUSE_LOCATION / house advertisement enum (252).
export const HOUSE_LOCATIONS = [
  { id: 1, name: "Rimmington", level: 1, cost: 5000, portal: 15478, board: 29091, x: 2954, y: 3224 },
  { id: 2, name: "Taverley", level: 10, cost: 5000, portal: 15477, board: 37384, x: 2894, y: 3465 },
  { id: 3, name: "Pollnivneach", level: 20, cost: 7500, portal: 15479, board: 37385, x: 3340, y: 3004 },
  { id: 8, name: "Hosidius", level: 25, cost: 8750, portal: 28822, board: 37386, x: 1743, y: 3517 },
  { id: 4, name: "Rellekka", level: 30, cost: 10000, portal: 15480, board: 37387, x: 2670, y: 3632 },
  { id: 13, name: "Aldarin", level: 35, cost: 12500, portal: 55353, board: 55352, x: 1422, y: 2965 },
  { id: 5, name: "Brimhaven", level: 40, cost: 15000, portal: 15481, board: 37388, x: 2758, y: 3178 },
  { id: 6, name: "Yanille", level: 50, cost: 25000, portal: 15482, board: 37389, x: 2544, y: 3096 },
  { id: 9, name: "Prifddinas", level: 70, cost: 50000, portal: 34947, board: 37390, x: 3239, y: 6076 },
] as const;

export type HouseStyle = Readonly<{
  name: string; level: number; cost: number; wall: number; window: number;
  doorHotspots: readonly number[]; doors: readonly number[];
  blueprint?: number; holiday?: string;
}>;

// Native template ordering: four themes per map column, one theme per source plane.
// Door leaves are ordered unmirrored/mirrored, closed then open.
export const HOUSE_STYLES: readonly HouseStyle[] = [
  { name: "Basic wood", level: 1, cost: 5000, wall: 13098, window: 13099, doorHotspots: [15313, 15314], doors: [13016, 13015, 13018, 13017] },
  { name: "Basic stone", level: 10, cost: 5000, wall: 13090, window: 13091, doorHotspots: [15307, 15308], doors: [13094, 13096, 13095, 13097] },
  { name: "Whitewashed stone", level: 20, cost: 7500, wall: 1415, window: 13005, doorHotspots: [15309, 15310], doors: [13007, 13006, 13009, 13008] },
  { name: "Fremennik-style wood", level: 30, cost: 10000, wall: 13111, window: 13112, doorHotspots: [15311, 15312], doors: [13109, 13107, 13110, 13108] },
  { name: "Tropical wood", level: 40, cost: 15000, wall: 13011, window: 1615, doorHotspots: [15305, 15306], doors: [13100, 13101, 13102, 13103] },
  { name: "Fancy stone", level: 50, cost: 25000, wall: 13116, window: 13117, doorHotspots: [15315, 15316], doors: [13119, 13118, 13121, 13120] },
  { name: "Deathly mansion", level: 1, cost: 35000, wall: 27082, window: 27083, doorHotspots: [27068, 27069], doors: [27084, 27085, 27086, 27087], holiday: "Halloween" },
  { name: "Twisted theme", level: 1, cost: 0, wall: 37467, window: 37469, doorHotspots: [37617, 37618], doors: [37465, 37463, 37466, 37464], blueprint: ItemIdentifiers.TWISTED_BLUEPRINTS },
  { name: "Hosidius house", level: 1, cost: 5000, wall: 39883, window: 39884, doorHotspots: [37436, 37437], doors: [37457, 37455, 39882, 37456], blueprint: ItemIdentifiers.HOSIDIUS_BLUEPRINTS },
  { name: "Cosy cabin", level: 1, cost: 35000, wall: 40862, window: 40863, doorHotspots: [40768, 40769], doors: [40860, 40858, 40861, 40859], holiday: "Christmas" },
  { name: "Civitas", level: 70, cost: 35000, wall: 56156, window: 56157, doorHotspots: [56143, 56144], doors: [56158, 56159, 56160, 56161] },
  { name: "Canifis", level: 60, cost: 10000, wall: 56151, window: 56153, doorHotspots: [56145, 56146], doors: [56149, 56147, 56150, 56148] },
  { name: "Wilderness theme", level: 1, cost: 0, wall: 60256, window: 60260, doorHotspots: [15307, 15308], doors: [13094, 13096, 13095, 13097], blueprint: ItemIdentifiers.ANNIHILATION_BLUEPRINTS },
];

export function houseLocation(save: PlayerHouseSave): typeof HOUSE_LOCATIONS[number] {
  return HOUSE_LOCATIONS.find(location => location.id === save.location) ?? HOUSE_LOCATIONS[0];
}

export function houseExit(save: PlayerHouseSave): Location {
  const { x, y } = houseLocation(save);
  return new Location(x, y, 0);
}

export function houseStyleIndex(save: PlayerHouseSave): number {
  return Number.isInteger(save.style) && HOUSE_STYLES[save.style!] ? save.style! : 0;
}

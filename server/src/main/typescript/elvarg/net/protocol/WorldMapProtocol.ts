import { CacheDefinitions } from "../../game/cache/CacheDefinitions";
import { CachePipeline } from "../../game/cache/CachePipeline";

export const WORLD_MAP_GROUP_ID = 595;
export const WORLD_MAP_TARGET_UID = (161 << 16) | 18;
export const WORLD_MAP_CLOSE_WIDGET_ID = (WORLD_MAP_GROUP_ID << 16) | 38;
/** The world map orb on each orbs interface: desktop, no-map and the mobile toplevel's. */
const WORLD_MAP_ORB_COMPONENTS = ["orbs:worldmap", "orbs_nomap:worldmap", "orbs_osm:worldmap"];
let worldMapOrbWidgetIds: number[] | undefined;

/** Whether a clicked component is a world map orb (looked up by gameval name, once). */
export function isWorldMapOrbWidget(widgetId: number): boolean {
  // A widget click before the cache is up (a test harness, or an early packet) cannot be an orb.
  if (!CachePipeline.isInitialized()) return false;
  worldMapOrbWidgetIds ??= WORLD_MAP_ORB_COMPONENTS
    .map((name) => CacheDefinitions.getComponentId(name))
    .filter((id): id is number => id !== null);
  return worldMapOrbWidgetIds.includes(widgetId);
}

export function packWorldMapCoord(x: number, y: number, level: number): number {
  const safeLevel = Math.max(0, Math.min(3, level | 0));
  return (safeLevel << 28) | ((x & 0x3fff) << 14) | (y & 0x3fff);
}

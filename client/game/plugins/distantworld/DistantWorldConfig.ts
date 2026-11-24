import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

export const DistantWorldConfig = ConfigGroup("distantworld", {
    distance: ConfigItem({ name: "Scenery distance", description: "Standalone scenery distance. GPU or 117 HD controls scenery while active; NPC previews follow its render distance.", range: { min: 128, max: 1024 }, default: 384, position: 1 }),
    npcs: ConfigItem({ name: "Distant NPCs", description: "Cosmetic NPCs animate and wander within their spawn radii. Stationary spawns stay fixed. Real NPCs take over in range.", default: true, position: 2 }),
    npcLimit: ConfigItem({ name: "NPC limit", description: "Maximum selected previews, prioritizing the camera view. Open the Distant World sidebar for coverage and server status.", range: { min: 16, max: 1024 }, default: 256, position: 3 }),
    showRange: ConfigItem({ name: "Show NPC update range", default: false, position: 4 }),
    deferredActions: ConfigItem({ name: "Approach and interact", description: "Resolve a real NPC after approaching. Unavailable or ambiguous targets stop the action.", default: true, position: 5 }),
    memoryBudget: ConfigItem({ name: "Geometry budget", description: "Total scene geometry budget in MiB. Detailed nearby scenery retains priority.", range: { min: 64, max: 512 }, default: 128, position: 6 }),
});

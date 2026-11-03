const fs = require("fs");
const path = require("path");

const NPC_EDITOR_CHANNEL = "npc-editor";
const SPAWN_LINEAGE_OWNER = "npc-spawns";
const SERVER_TO_SPAWN_DIRECTION = [5, 6, 7, 3, 4, 0, 1, 2];

/** Read-only local editor files, on the existing game HTTP port. */
function worldResource(core, _query, segments) {
  if (core.Server.PRODUCTION) return undefined;
  if (segments.length === 0) return core.WorldDefinition.getWorldDefinition();
  if (segments.length !== 1) return undefined;
  const file = segments[0] === "object-spawns" ? "object-spawns.json"
    : segments[0] === "npc-spawns" ? "npc-spawns.json"
    : segments[0] === "npc-spawns-custom" ? "npc-spawns-custom.json" : undefined;
  if (!file) return undefined;
  const full = path.resolve(process.cwd(), "data/definitions", file);
  if (!fs.existsSync(full)) return file === "npc-spawns-custom.json" ? [] : undefined;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

/** Resolve a visible NPC's persisted origin, never its wandered current tile. */
function receiveEditorMessage(core, event) {
  if (event.channel !== NPC_EDITOR_CHANNEL) return;
  event.handled = true;
  const { player, data } = event;
  if (data.type !== "spawn" || !Number.isSafeInteger(data.request) || data.request < 0 ||
      !Number.isInteger(data.index) || data.index < 1 || data.index > 0xffff ||
      !Number.isInteger(data.id) || data.id < 0 ||
      !Number.isInteger(data.x) || data.x < 0 || data.x > 0x3fff ||
      !Number.isInteger(data.y) || data.y < 0 || data.y > 0x3fff ||
      !Number.isInteger(data.plane) || data.plane < 0 || data.plane > 3) return;
  const npc = core.World.getNpcs().get(data.index);
  let spawn;
  const lineage = npc?.getSpawnLineage();
  const location = npc?.getLocation();
  if (npc && player.getLocalNpcs().includes(npc) && npc.isRegistered() &&
      lineage?.owner === SPAWN_LINEAGE_OWNER && !lineage.isRetired() &&
      npc.getId() === data.id && location.getX() === data.x &&
      location.getY() === data.y && location.getZ() === data.plane) {
    const origin = npc.getSpawnPosition();
    const definitions = core.NpcSpawnDefinition.all().filter((definition) =>
      definition.getId() === npc.getRealId() && definition.getPosition().equals(origin));
    // Duplicate source records are ambiguous: editing one must not remove both.
    if (definitions.length === 1) {
      const definition = definitions[0];
      spawn = {
        id: definition.getId(), tileX: origin.getX(), tileY: origin.getY(), plane: origin.getZ(),
        wanderRadius: definition.getRadius(),
        direction: SERVER_TO_SPAWN_DIRECTION[definition.getFacing().getId()],
        ...(definition.getDescription() ? { name: definition.getDescription() } : {}),
      };
    }
  }
  player.getSession().sendClientPacket(core.encodePluginMessage(NPC_EDITOR_CHANNEL, {
    type: "spawn", request: data.request, ...(spawn ? { spawn } : {}),
  }));
}

module.exports = {
  name: "EditModeApi",
  register(api) {
    api.registerContentEndpoint("world", worldResource.bind(null, api.core));
    api.onCustomEvent("network:plugin-message", receiveEditorMessage.bind(null, api.core));
  },
};

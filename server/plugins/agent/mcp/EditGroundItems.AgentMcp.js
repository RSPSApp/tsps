const { readGroundItemEdits, updateGroundItem } = require("../../world/GroundItemsEditor.plugin");

module.exports = function registerGroundItemTools({ core, tool, z }) {
  const source = {
    id: z.number().int().min(0).max(65535),
    x: z.number().int().min(0).max(16383),
    y: z.number().int().min(0).max(16383),
    plane: z.number().int().min(0).max(3),
  };
  const placement = ({ id, x, y, plane }) => {
    if (!core.CacheDefinitions.hasItem(id)) throw new Error(`Unknown item ID ${id}`);
    if (![x, y, plane].every(Number.isInteger) || x < 0 || y < 0 || x > 16383 || y > 16383 || plane < 0 || plane > 3) {
      throw new Error("Choose a valid world tile");
    }
    return { id, location: { x, y, z: plane } };
  };
  tool("list_map_ground_items", "List custom static ground items authored with the map editor.", {},
    () => ({ items: readGroundItemEdits() }));
  tool("set_map_ground_item", "Add or update an item on the ground. The world loads changes at restart.", {
    ...source, quantity: z.number().int().min(1).max(2147483647).default(1),
    respawn: z.number().int().min(0).max(86400).default(0),
  }, (input) => {
    const amt = input.quantity ?? 1, respawn = input.respawn ?? 0;
    if (!Number.isInteger(amt) || amt < 1 || amt > 2147483647 || !Number.isInteger(respawn) || respawn < 0 || respawn > 86400) {
      throw new Error("Choose a valid quantity and respawn interval");
    }
    const item = { ...placement(input), amt, respawn };
    updateGroundItem(item, false);
    return { item, restartRequired: true };
  });
  tool("remove_map_ground_item", "Remove a custom static ground item at a tile. The world loads changes at restart.", source,
    (input) => ({ removed: updateGroundItem(placement(input), true), restartRequired: true }));
};

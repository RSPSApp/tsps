const { listWarps, normalizeSource, normalizeWarp, updateWarps, warpAt, pairedWarp } = require("../../world/MapWarps");
const { reloadSavedMap } = require("../../world/SavedMapReload");

module.exports = function registerWarpTools({ core, tool, z }, onChanged = () => {}) {
  const tile = z.tuple([z.number().int().min(0).max(16383), z.number().int().min(0).max(16383), z.number().int().min(0).max(3)]);
  const source = {
    id: z.number().int().min(0).max(65535),
    op: z.number().int().min(1).max(5),
    from: tile,
  };
  tool("reload_saved_region", "Reload a saved editor pack, rebuild world collision and stream the region to connected players.", {
    regionId: z.number().int().min(0).max(65535),
  }, ({ regionId }) => reloadSavedMap(core, regionId));
  tool("list_map_warps", "List custom editor travel links. Each matches an exact object ID, tile and click option.", {},
    () => ({ warps: listWarps() }));
  const actionLabel = z.string().max(40).optional();
  const beside = z.object({ id: source.id, at: tile }).optional();
  tool("set_map_warp", "Add or rename a menu action on any placed object. Destinations can land on a tile or beside an object. Set returnFrom to create or move the return action, omit it to retain an existing pair, or pass null for a one-way warp.", {
    ...source,
    actionLabel,
    destinations: z.array(z.object({ label: z.string(), to: tile, beside })).min(1).max(4),
    returnFrom: z.object({ ...source, actionLabel }).nullable().optional(),
  }, (input) => {
    const existing = warpAt(input.id, input.op, input.from);
    const paired = pairedWarp(existing);
    const forward = normalizeWarp({
      ...input,
      actionLabel: input.actionLabel ?? existing?.actionLabel,
      returnLink: input.returnFrom === undefined ? paired : input.returnFrom ?? undefined,
    });
    const changes = [forward];
    if (input.returnFrom) {
      const { id, op, from } = input.returnFrom;
      const current = warpAt(id, op, from);
      changes.push(normalizeWarp({
        ...input.returnFrom,
        actionLabel: input.returnFrom.actionLabel ?? current?.actionLabel ?? "Return",
        destinations: current && current === paired ? current.destinations
          : [{ label: "Return", to: forward.from, beside: { id: forward.id, at: forward.from } }],
        returnLink: forward,
      }));
    }
    for (const warp of changes) {
      const definition = core.ObjectDefinition.forId(warp.id);
      if (!definition) throw new Error(`Object ${warp.id} is missing from the cache`);
      if (!warp.actionLabel && !definition.getInteractions?.()?.[warp.op - 1]) {
        throw new Error(`Name the new option on object ${warp.id}`);
      }
    }
    updateWarps(changes);
    onChanged();
    return { warps: changes };
  });
  tool("remove_map_warp", "Remove an exact custom action and its paired return, if any, restoring the original object options.", source, (input) => {
    const warp = normalizeSource(input);
    updateWarps([warp], true);
    onChanged();
    return { removed: warp.from, id: warp.id, op: warp.op };
  });
};

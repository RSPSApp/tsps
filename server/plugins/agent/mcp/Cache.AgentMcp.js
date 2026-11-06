// Read-only cache inspection: one definition with its values and links, a name/id search, and the
// reverse question. This is the inspect half an editor page sits on; nothing here writes.
const inspect = require("../../tools/cache-editor/Inspect.CacheEditor");

module.exports = function registerCacheTools(ctx) {
  const { core, tool, z, player, find } = ctx;
  const kind = z.string().describe("Cache kind: loc, npc, item, varbit, varp, seq, spotanim, struct, enum, dbro, dbtable, idk, inv, bas, model, sprite, sound, param");

  tool(
    "cache_kinds",
    "Every cache kind this server can inspect, with how many definitions it holds and whether a decoder exists yet. Read-only.",
    {},
    () => ({ kinds: inspect.kinds(core) })
  );

  tool(
    "cache_inspect",
    "Read one cache definition: its name, every field value, and every link it holds (a loc's animation is a sequence, an item's noted form is an item, a varbit names its varp), each with the target's name and whether it resolves. Multi-defs report their gating variable and children instead of pretending the id is what a player sees. Read-only.",
    {
      kind,
      id: z.number().int().min(0).describe("Definition id in that kind"),
      player: player.optional().describe("Online player, to resolve a multi-def the way that player sees it"),
      includeUnset: z.boolean().default(false).describe("Keep -1 and empty fields instead of omitting them"),
    },
    ({ kind: name, id, player: username, includeUnset }) => {
      const target = username ? find(username) : null;
      return inspect.describe(core, { kind: name, id, player: target, skipUnset: !includeUnset });
    }
  );

  tool(
    "cache_search",
    "Find cache ids by gameval name or by id, within one kind or across every named kind. Names are the cache's developer names (ent_totems_site_1_base), and custom items are included. Read-only.",
    {
      text: z.string().min(1).describe("Part of a name, or a numeric id"),
      kind: kind.optional().describe("Restrict to one kind"),
      limit: z.number().int().min(1).max(100).default(20),
    },
    ({ text, kind: name, limit }) => ({ hits: inspect.search(core, { kind: name ?? null, text, limit }) })
  );

  tool(
    "cache_used_by",
    "Which locs, npcs and items point at this id — the reverse of cache_inspect's links. Scans the definitions once per loaded cache and memoises, so the first call is slower. Read-only.",
    { kind, id: z.number().int().min(0), limit: z.number().int().min(1).max(200).default(50) },
    ({ kind: name, id, limit }) => inspect.usedBy(core, { kind: name, id, limit })
  );
};

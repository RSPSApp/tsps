// Read-only cache resources for the editor page, on the same origin the client already connects to.
// `api.registerContentEndpoint` is public and read-only by design, and everything served here is
// cache-derived data the browser could read out of its own cache — so nothing player-specific and
// nothing writable belongs in this file.
const path = require("node:path");
const inspect = require("./Inspect.CacheEditor");
const Document = require("./Document.CacheEditor.cjs");
const Assets = require("./Assets.CacheEditor.cjs");

function need(query, name) {
  const value = query.get(name);
  if (value === null || value === "") throw new Error(`Missing ?${name}`);
  return value;
}

function number(query, name) {
  const value = Number(need(query, name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`?${name} must be a non-negative integer`);
  return value;
}

function limitOf(query) {
  const limit = Number(query.get("limit") ?? 20);
  return Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
}

function register(api) {
  const { core } = api;
  // Apply the overlay document once at startup, so an authored row is live on the next boot without
  // an encoder or a cache repack. Load failures are reported, never silently ignored.
  const root = path.resolve(__dirname, "../../../..");
  api.onServerStartup(() => {
    try {
      const document = Document.read(root);
      const applied = core.CacheDefinitions.registerCustomDefinitions(document.rows);
      const models = Assets.customModels(root);
      if (models.length) core.CacheDefinitions.setCustomModels(models);
      inspect.setAssetNames(Assets.assetNames(root));
      if (applied || models.length) console.log(`[cache-editor] applied ${applied} overlay definition(s), ${models.length} model asset(s)`);
    } catch (error) {
      console.error("[cache-editor] overlay document not applied:", error.message);
    }
  });

  // Uploaded models have to reach the browser the same way the item overlay's do.
  api.onPlayerLogin(({ player }) => {
    const models = Assets.customModels(root);
    if (!models.length || !player.getSession()) return;
    for (const model of models) player.getPacketSender().sendContentData("server", [{ key: "customModels", rows: [model] }]);
  });
  api.registerContentEndpoint("cache-kinds", () => ({ kinds: inspect.kinds(core) }));
  api.registerContentEndpoint("cache-inspect", (query) => inspect.describe(core, {
    kind: need(query, "kind"),
    id: number(query, "id"),
    skipUnset: query.get("unset") !== "1",
  }));
  api.registerContentEndpoint("cache-search", (query) => ({
    hits: inspect.search(core, {
      kind: query.get("kind") || null,
      text: need(query, "text"),
      limit: limitOf(query),
    }),
  }));
  // The field table a form is generated from: every reference field, with the kind it points at, so
  // a picker can search that kind by gameval name instead of asking for an id.
  api.registerContentEndpoint("cache-fields", (query) => ({
    kind: need(query, "kind"),
    fields: inspect.fields(need(query, "kind"), { referencesOnly: query.get("all") !== "1" }),
  }));
  /**
   * The asset lookup: the cache's own groups in one index, plus everything uploaded here. The cache
   * has no names for models or sprites, so an uploaded asset's name is the only human label there is.
   */
  api.registerContentEndpoint("cache-assets", (query) => {
    const kind = need(query, "kind");
    const entry = Assets.kindOf(kind);
    const needle = String(query.get("q") ?? "").trim().toLowerCase();
    const offset = Math.max(0, Number(query.get("offset") ?? 0) | 0);
    const limit = Math.min(500, Math.max(1, Number(query.get("limit") ?? 100) | 0));
    const mine = Assets.assetsOf(root).filter((asset) => asset.kind === kind);
    const store = core.CachePipeline?.getStore?.();
    const cacheIds = [];
    if (store) {
      // `core` exposes both, so no relative path into dist.
      const { CacheIndexDat2 } = core;
      const { IndexType } = require("../../../dist/game/cache/codec/rs/cache/IndexType");
      const indexType = kind === "model" ? IndexType.DAT2.models : kind === "sprite" ? IndexType.DAT2.sprites : IndexType.DAT2.textures;
      const index = CacheIndexDat2.fromStore(indexType, store);
      const ids = index.getArchiveIds();
      for (let position = offset; position < ids.length && cacheIds.length < limit; position += 1) cacheIds.push(ids[position]);
      return {
        kind,
        index: entry.index,
        total: ids.length,
        offset,
        limit,
        cache: cacheIds,
        mine,
      };
    }
    return { kind, index: entry.index, total: mine.length, offset, limit, cache: [], mine };
  });
  api.registerContentEndpoint("cache-used-by", (query) => inspect.usedBy(core, {
    kind: need(query, "kind"),
    id: number(query, "id"),
    limit: limitOf(query),
  }));
}

module.exports = { name: "CacheEditorCatalog", register };

const fs = require("fs");
const path = require("path");

function requireGameModule(modulePath) {
  const candidates = [
    path.resolve(process.cwd(), "src", "main", "typescript", "elvarg", modulePath),
    path.resolve(process.cwd(), "dist", modulePath),
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const getGameConstants = () =>
  requireGameModule(path.join("game", "GameConstants")).GameConstants;
const getItemDefinition = () =>
  requireGameModule(path.join("game", "definition", "ItemDefinition"))
    .ItemDefinition;
const getEquipmentType = () =>
  requireGameModule(path.join("game", "model", "EquipmentType"))
    .EquipmentType;
const getWeaponInterfaces = () =>
  requireGameModule(path.join("game", "content", "combat", "WeaponInterfaces"))
    .WeaponInterfaces;
const { CacheDefinitions } = requireGameModule("game/cache/CacheDefinitions");
const { encodeContentData } = requireGameModule("net/protocol/ClientProtocol");

const BARROWS_BASE_ITEMS = [
  4708, 4710, 4712, 4714, 4716, 4718, 4720, 4722,
  4724, 4726, 4728, 4730, 4732, 4734, 4736, 4738,
  4745, 4747, 4749, 4751, 4753, 4755, 4757, 4759,
];

function hydrateEquipmentType(raw) {
  const EquipmentType = getEquipmentType();
  if (raw && typeof raw.getSlot === "function") {
    return raw;
  }
  if (typeof raw === "string" && EquipmentType[raw] != null) {
    return EquipmentType[raw];
  }
  return EquipmentType.NONE;
}

function hydrateWeaponInterface(raw) {
  if (raw == null) {
    return null;
  }
  if (raw && typeof raw.getInterfaceId === "function") {
    return raw;
  }
  const WeaponInterfaces = getWeaponInterfaces();
  if (typeof raw === "string") {
    return WeaponInterfaces?.[raw] ?? null;
  }
  return null;
}

function getItemDefinitionsPath() {
  const GameConstants = getGameConstants();
  return path.resolve(
    process.cwd(),
    GameConstants.DEFINITIONS_DIRECTORY,
    "item-gameplay.json"
  );
}

// OSRS Grand Exchange quotes (yarn fetch:prices) onto ItemDefinition, kept
// separate from the cache's store value that shops and valuation use.
function loadItemPrices() {
  const ItemDefinition = getItemDefinition();
  const filePath = path.resolve(
    process.cwd(),
    getGameConstants().DEFINITIONS_DIRECTORY,
    "item-prices.json"
  );
  if (!fs.existsSync(filePath)) {
    return { filePath, loaded: 0 };
  }
  const { data } = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid item-prices.json: expected a data object");
  }
  let loaded = 0;
  for (const [key, quote] of Object.entries(data)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0) continue;
    const definition = ItemDefinition.forId(id);
    if (definition === ItemDefinition.DEFAULT) continue;

    const prices = [quote?.high, quote?.low].filter(
      (value) => Number.isSafeInteger(value) && value > 0
    );
    if (!prices.length) continue;

    // Some live quotes are inverted (high below low). Charge the higher guide price
    // as the buy and the lower as the sell so the spread cannot be arbitraged.
    const buy = Math.max(...prices);
    const sell = Math.min(...prices);
    definition.grandExchangeValue = buy;
    definition.grandExchangeSellValue = sell;
    const noteId = definition.getNoteId();
    if (!definition.isNoted() && noteId >= 0) {
      const note = ItemDefinition.forId(noteId);
      if (note.isNoted() && note.getNoteId() === id) {
        note.grandExchangeValue = buy;
        note.grandExchangeSellValue = sell;
      }
    }
    loaded += 1;
  }
  return { filePath, loaded };
}

// High/low alchemy values from osrsreboxed-db's item-alch.json.
// Applied after item-gameplay.json so the cache-derived values win over the old export.
function loadItemAlch() {
  const ItemDefinition = getItemDefinition();
  const filePath = path.resolve(
    process.cwd(),
    getGameConstants().DEFINITIONS_DIRECTORY,
    "item-alch.json"
  );
  if (!fs.existsSync(filePath)) {
    return { filePath, loaded: 0 };
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid item-alch.json: expected an object keyed by item id");
  }
  let loaded = 0;
  for (const [key, values] of Object.entries(data)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0) continue;
    const definition = ItemDefinition.forId(id);
    if (definition === ItemDefinition.DEFAULT) continue;
    definition.highAlch = Number.isSafeInteger(values?.highalch) ? values.highalch : 0;
    definition.lowAlch = Number.isSafeInteger(values?.lowalch) ? values.lowalch : 0;
    loaded += 1;
  }
  return { filePath, loaded };
}

function loadItemDefinitions() {
  const ItemDefinition = getItemDefinition();
  const filePath = getItemDefinitionsPath();
  const content = fs.readFileSync(filePath, "utf8");
  const rawDefs = JSON.parse(content);
  const defs = Array.isArray(rawDefs) ? rawDefs : Object.values(rawDefs);

  ItemDefinition.definitions.clear();

  let loaded = 0;
  let unresolvedWeaponInterfaces = 0;
  let mismatched = 0;
  for (const rawDef of defs) {
    if (!rawDef || typeof rawDef !== "object") {
      continue;
    }

    const id = rawDef.id;
    if (!Number.isInteger(id) || id < 0) {
      continue;
    }
    const def = ItemDefinition.forId(id);
    if ((rawDef.name || "").trim().toLowerCase() !== def.getName().trim().toLowerCase()) {
      mismatched++;
      continue;
    }
    // The equipment slot is the cache wearPos (ItemDefinition), never the export's equipmentType:
    // it marks ~800 unwearable items FULL_HELMET (packs, Eel sushi, Cog) and gives others the
    // wrong slot (Torag's hammers as a helmet, Verac's brassard as a weapon).
    def.weaponInterface = hydrateWeaponInterface(rawDef.weaponInterface);
    // Two-handedness is the cache's (ItemDefinition), like stackable and tradeable.
    for (const property of [
      "sellable", "bloodMoneyValue", "highAlch",
      "lowAlch", "dropValue", "blockAnim", "standAnim", "walkAnim", "runAnim",
      "standTurnAnim", "turn180Anim", "turn90CWAnim", "turn90CCWAnim", "attackAnim", "equipSound", "bonuses",
      "requirements", "deathComponents", "combatRequirement",
    ]) {
      if (rawDef[property] === undefined) continue;
      // The cache's stat params are the current game's; the export's bonuses only fill items
      // the cache has none for.
      if (property === "bonuses" && def.hasCacheBonuses()) continue;
      def[property] = rawDef[property];
    }
    if (rawDef.weaponInterface != null && def.weaponInterface == null) {
      unresolvedWeaponInterfaces++;
    }

    loaded += 1;
  }

  // Degraded Barrows pieces wear as their base piece. The cache gives them its stats, and the
  // broken ("0") pieces none, which item-gameplay.json would otherwise fill.
  for (const baseId of BARROWS_BASE_ITEMS) {
    const base = ItemDefinition.forId(baseId);
    const index = BARROWS_BASE_ITEMS.indexOf(baseId);
    for (let stage = 0; stage < 5; stage++) {
      const variant = ItemDefinition.forId(4856 + index * 6 + stage);
      variant.equipmentType = base.equipmentType;
      variant.weaponInterface = base.weaponInterface;
      variant.doubleHanded = base.doubleHanded;
      variant.requirements = [...base.requirements];
      if (stage === 4) variant.bonuses = new Array(14).fill(0);
    }
  }

  const customPath = path.resolve(process.cwd(), getGameConstants().DEFINITIONS_DIRECTORY, "custom-items.json");
  let customRows = [];
  if (fs.existsSync(customPath)) {
    const parsed = JSON.parse(fs.readFileSync(customPath, "utf8"));
    customRows = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
  }
  const modelRoot = path.resolve(process.cwd(), getGameConstants().DEFINITIONS_DIRECTORY, "../models");
  const customModels = [];
  const modelIds = new Set();
  for (const row of customRows) {
    for (const [rawId, rawFile] of Object.entries(row.models ?? {})) {
      const modelId = Number(rawId);
      if (!Number.isInteger(modelId) || modelId < 1000000 || modelIds.has(modelId) || typeof rawFile !== "string" || !/^[a-zA-Z0-9._/-]+\.dat$/.test(rawFile)) {
        throw new Error(`[custom-items] invalid model ${String(rawId)} for item ${row.id}`);
      }
      modelIds.add(modelId);
      const filePath = fs.realpathSync(path.resolve(modelRoot, rawFile));
      if (!filePath.startsWith(`${modelRoot}${path.sep}`)) throw new Error(`[custom-items] model path escapes data/models: ${rawFile}`);
      const data = fs.readFileSync(filePath);
      if (data.length < 18 || data.length > 1024 * 1024) throw new Error(`[custom-items] model ${filePath} must be 18 bytes..1 MiB`);
      const model = { id: modelId, data: data.toString("base64") };
      if (encodeContentData("server", [{ key: "customModels", rows: [model] }]).length > 0xffff) {
        throw new Error(`[custom-items] model packet ${modelId} exceeds protocol limit`);
      }
      customModels.push(model);
    }
  }
  for (const row of customRows) {
    for (const [key, value] of Object.entries(row.objType ?? {})) {
      if (/^(model|(?:male|female)(?:Head)?Model[12]?)$/.test(key) && value >= 1000000 && !modelIds.has(value)) {
        throw new Error(`[custom-items] item ${row.id} references missing model ${value}`);
      }
    }
    const props = row.itemDef ?? {};
    for (const [key, value] of Object.entries(props)) {
      if (["equipmentType", "weaponInterface"].includes(key)) continue;
      if (["bonuses", "requirements"].includes(key)) {
        if (!Array.isArray(value) || !value.every(Number.isFinite)) throw new Error(`[custom-items] invalid ${key} for item ${row.id}`);
      } else if (["doubleHanded", "stackable", "tradeable", "dropable", "sellable"].includes(key)) {
        if (typeof value !== "boolean") throw new Error(`[custom-items] invalid ${key} for item ${row.id}`);
      } else if (!Number.isFinite(value)) {
        throw new Error(`[custom-items] invalid ${key} for item ${row.id}`);
      }
    }
    if (props.equipmentType !== undefined && !getEquipmentType()[props.equipmentType]) {
      throw new Error(`[custom-items] invalid equipmentType for item ${row.id}`);
    }
    if (props.weaponInterface !== undefined && !getWeaponInterfaces()[props.weaponInterface]) {
      throw new Error(`[custom-items] invalid weaponInterface for item ${row.id}`);
    }
  }
  // ponytail: one compressed packet per model/definition list; use chunked delivery if these outgrow 64 KiB.
  if (encodeContentData("server", [{ key: "customItems", rows: customRows }]).length > 0xffff) {
    throw new Error("[custom-items] definitions exceed the transport limit");
  }
  CacheDefinitions.registerCustomItems(customRows);
  CacheDefinitions.setCustomModels(customModels);
  for (const row of CacheDefinitions.getCustomItems()) {
    const props = { ...(row.itemDef ?? {}) };
    if (typeof props.equipmentType === "string") props.equipmentType = hydrateEquipmentType(props.equipmentType);
    if (typeof props.weaponInterface === "string") props.weaponInterface = hydrateWeaponInterface(props.weaponInterface);
    ItemDefinition.registerCustom(row.id, row.baseItemId ?? -1, props);
  }

  return {
    filePath,
    loaded,
    total: ItemDefinition.definitions.size,
    unresolvedWeaponInterfaces,
    mismatched,
    prices: loadItemPrices(),
    alch: loadItemAlch(),
  };
}

function customItemsResource() { return CacheDefinitions.getCustomItems(); }

function customModelsResource(_query, segments) {
  const models = CacheDefinitions.getCustomModels();
  return segments.length ? models.find((model) => String(model.id) === segments[0]) : models;
}

function sendCustomItems({ player }) {
  const sender = player.getPacketSender();
  sender.sendContentData("server", [{ key: "customModels", rows: [] }]);
  for (const model of CacheDefinitions.getCustomModels()) {
    sender.sendContentData("server", [{ key: "customModels", rows: [model] }]);
  }
  sender.sendContentData("server", [{ key: "customItems", rows: CacheDefinitions.getCustomItems() }]);
}

module.exports = {
  name: "ItemDefinitionLoader",
  _test: { loadItemPrices, loadItemAlch },
  register(api) {
    const startedAt = Date.now();
    const result = loadItemDefinitions();
    api.log("loaded", {
      file: path.relative(process.cwd(), result.filePath),
      loaded: result.loaded,
      total: result.total,
      unresolvedWeaponInterfaces: result.unresolvedWeaponInterfaces,
      mismatched: result.mismatched,
      prices: result.prices.loaded,
      alch: result.alch.loaded,
      elapsedMs: Date.now() - startedAt,
    });
    api.registerContentEndpoint("custom-items", customItemsResource);
    api.registerContentEndpoint("custom-models", customModelsResource);
    api.onPlayerLogin(sendCustomItems);
  },
};

const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { PrayerData, PrayerHandler } = require("../../../src/main/typescript/elvarg/game/content/PrayerHandler");
const { SkillManager } = require("../../../src/main/typescript/elvarg/game/content/skill/SkillManager");
const { CombatSpecial } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { CombatSpells } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { Autocasting } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/Autocasting");
const { Presetable } = require("../../../src/main/typescript/elvarg/game/content/presets/Presetable");
const { Wilderness } = require("../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { isSafeLocation: isFeroxSafeLocation } = require("../../items/LootKeys.plugin");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { MagicSpellbook } = require("../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Flag } = require("../../../src/main/typescript/elvarg/game/model/Flag");
const { Bank } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const fs = require("fs");
const path = require("path");
const {
  GROUP_ID,
  COMPONENT,
  PRESET_ROW_START,
  PRESET_ROW_COUNT,
  GLOBAL_ROW_COUNT,
  CUSTOM_ROW_COUNT,
  INVENTORY_SLOT_START,
  INVENTORY_SLOT_COUNT,
  EQUIPMENT_SLOT_START,
  EQUIPMENT_PLACEHOLDER_START,
  EQUIPMENT_SLOTS,
  STAT_ROW_START,
  STAT_MAX_ROW_START,
  uid,
  buildPresetsInterfaceDefinition,
} = require("./presetsWidget");

const OPEN_ON_DEATH_ATTRIBUTE = "pvp:openPresetsOnDeath";
const CUSTOM_PRESETS_ATTRIBUTE = "pvp:customPresets";
const CUSTOM_PRESET_SLOT_ATTRIBUTE = "pvp:selectedCustomPresetSlot";
let presetsEnabled = false;

function shouldOpenOnDeath(player) {
  return player.getAttribute(OPEN_ON_DEATH_ATTRIBUTE) !== false;
}

const MAX_PRESETS = CUSTOM_ROW_COUNT;
const MAIN_MODAL_UID = (161 << 16) | 16;

const INTERFACE_DEFINITION = buildPresetsInterfaceDefinition();

const STAT_LABELS = ["Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic"];
// One list: the predefined presets, then the player's own slots.
const GLOBAL_ROW_UIDS = Array.from({ length: GLOBAL_ROW_COUNT }, (_, row) =>
  uid(PRESET_ROW_START + row)
);
const CUSTOM_ROW_UIDS = Array.from({ length: CUSTOM_ROW_COUNT }, (_, row) =>
  uid(PRESET_ROW_START + GLOBAL_ROW_COUNT + row)
);
const PRESET_BUTTON_UIDS = [
  uid(COMPONENT.LOAD_BUTTON),
  uid(COMPONENT.SAVE_BUTTON),
  uid(COMPONENT.DEATH_BUTTON),
  ...GLOBAL_ROW_UIDS,
  ...CUSTOM_ROW_UIDS,
];

const COMBAT_SKILLS = [
  Skill.ATTACK,
  Skill.DEFENCE,
  Skill.STRENGTH,
  Skill.HITPOINTS,
  Skill.RANGED,
  Skill.PRAYER,
  Skill.MAGIC,
];

const SPELLBOOKS = { NORMAL: MagicSpellbook.NORMAL, ANCIENT: MagicSpellbook.ANCIENT, LUNAR: MagicSpellbook.LUNAR, ARCEUUS: MagicSpellbook.ARCEUUS };
const EQUIPMENT_KEYS = new Set(["head", "cape", "amulet", "weapon", "body", "shield", "legs", "hands", "feet", "ring", "ammo"]);

function loadPlayerPresets() {
  const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "pvp-presets-players.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows) || rows.length !== GLOBAL_ROW_COUNT) throw new Error(`[presets] ${file} must contain ${GLOBAL_ROW_COUNT} presets`);
  const keys = new Set();
  const readItem = (value, location) => {
    const itemKey = typeof value === "string" ? value : value?.[0];
    const amount = typeof value === "string" ? 1 : value?.[1];
    if (typeof itemKey !== "string" || (typeof value !== "string" && (!Array.isArray(value) || value.length !== 2))) throw new Error(`[presets] ${location} must be an ItemIdentifiers key or [key, amount]`);
    const id = ItemIdentifiers[itemKey];
    if (!Number.isInteger(id)) throw new Error(`[presets] ${location} has unknown ItemIdentifiers key ${itemKey}`);
    if (!Number.isInteger(amount) || amount < 1 || amount > 0x7fffffff) throw new Error(`[presets] ${location}.amount must be 1..2147483647`);
    return new Item(id, amount);
  };
  const presets = rows.map((row, index) => {
    const location = `row ${index}`;
    if (!row || typeof row !== "object" || typeof row.key !== "string" || !/^[A-Z0-9_]+$/.test(row.key) || keys.has(row.key)) throw new Error(`[presets] ${location} has an invalid or duplicate key`);
    keys.add(row.key);
    if (typeof row.name !== "string" || !row.name.trim()) throw new Error(`[presets] ${location}.name must be a non-empty string`);
    if (!Array.isArray(row.inventory) || row.inventory.length > 28) throw new Error(`[presets] ${location}.inventory must contain at most 28 items`);
    if (!row.equipment || typeof row.equipment !== "object" || Array.isArray(row.equipment) || Object.keys(row.equipment).some((slot) => !EQUIPMENT_KEYS.has(slot))) throw new Error(`[presets] ${location}.equipment has an invalid slot name`);
    if (!Array.isArray(row.stats) || row.stats.length !== 7 || row.stats.some((level) => !Number.isInteger(level) || level < 1 || level > 99)) throw new Error(`[presets] ${location}.stats must contain seven levels from 1 to 99`);
    if (!Object.hasOwn(SPELLBOOKS, row.spellbook)) throw new Error(`[presets] ${location}.spellbook is invalid`);
    if (row.autocastSpellId !== undefined && !Number.isInteger(row.autocastSpellId)) throw new Error(`[presets] ${location}.autocastSpellId must be an integer`);
    return [row.key, new Presetable(row.name, row.inventory.map((item, slot) => readItem(item, `${location}.inventory[${slot}]`)), Object.entries(row.equipment).map(([slot, item]) => readItem(item, `${location}.equipment.${slot}`)), row.stats, SPELLBOOKS[row.spellbook], true, row.autocastSpellId ?? -1)];
  });
  return { list: presets.map(([, preset]) => preset), byKey: new Map(presets) };
}

const PLAYER_PRESETS = loadPlayerPresets();
const GLOBAL_PRESETS = PLAYER_PRESETS.list;

function getGlobalPresetPool() {
  return GLOBAL_PRESETS.filter((preset) => preset != null);
}

function getGlobalPresetByName(name) {
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  const target = name.trim().toLowerCase();
  for (const preset of getGlobalPresetPool()) {
    const presetName = preset?.getName?.();
    if (typeof presetName === "string" && presetName.trim().toLowerCase() === target) {
      return preset;
    }
  }
  return null;
}

function getGlobalPresetByKey(key) {
  return typeof key === "string" ? PLAYER_PRESETS.byKey.get(key) ?? null : null;
}

function resolvePresetPool(options = {}) {
  const presetNames = Array.isArray(options?.presetNames)
    ? options.presetNames.filter((value) => typeof value === "string" && value.length > 0)
    : [];
  if (presetNames.length === 0) {
    return getGlobalPresetPool();
  }
  const resolved = presetNames
    .map((presetName) => getGlobalPresetByName(presetName))
    .filter((preset) => preset != null);
  return resolved.length > 0 ? resolved : getGlobalPresetPool();
}

function pickRandomGlobalPresetFromPool(options = {}) {
  const pool = resolvePresetPool(options);
  if (pool.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? null;
}

function isPlayerBot(player) {
  return Boolean(player?.isPlayerBot?.());
}

function isPresetInterfaceOpen(player) {
  return player?.getInterfaceId?.() === GROUP_ID;
}

/**
 * Equipment slot for an item, straight from the cache. ItemDefinition.equipmentType is
 * never populated in this port - getEquipmentType().getSlot() returns -1 for every item -
 * so the cache's wearPos is the only working source.
 */
function equipmentSlotOf(itemId) {
  const wearPos = CacheDefinitions.getItem(itemId)?.wearPos;
  return EQUIPMENT_SLOTS.includes(wearPos) ? wearPos : -1;
}

function isValidItem(item) {
  return (
    item &&
    typeof item.getId === "function" &&
    typeof item.getAmount === "function" &&
    item.getId() > 0 &&
    item.getAmount() > 0
  );
}

function cloneItem(item) {
  if (!isValidItem(item)) {
    return null;
  }
  return typeof item.clone === "function"
    ? item.clone()
    : new Item(item.getId(), item.getAmount());
}

function isSpawnable(itemId) {
  const allowed = GameConstants.ALLOWED_SPAWNS;
  if (allowed?.has) {
    return allowed.has(itemId);
  }
  if (Array.isArray(allowed)) {
    return allowed.includes(itemId);
  }
  return false;
}

function itemRecord(item) {
  if (!isValidItem(item)) {
    return null;
  }
  return {
    id: item.getId(),
    amount: item.getAmount(),
    meta: item.getMeta?.() ?? null,
  };
}

function itemFromRecord(record) {
  const id = Number(record?.id);
  const amount = Number(record?.amount);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  return new Item(id, amount, record?.meta ?? null);
}

function spellbookFromRecord(record) {
  const interfaceId = Number(record?.spellbookId);
  return [
    MagicSpellbook.NORMAL,
    MagicSpellbook.ANCIENT,
    MagicSpellbook.LUNAR,
    MagicSpellbook.ARCEUUS,
  ].find((spellbook) => spellbook.getInterfaceId() === interfaceId) ??
    MagicSpellbook.NORMAL;
}

function presetFromRecord(record) {
  const name = typeof record?.name === "string" ? record.name : "";
  if (!name) {
    return null;
  }
  const inventory = Array.isArray(record.inventory)
    ? record.inventory.map(itemFromRecord).filter((item) => item != null)
    : [];
  const equipment = Array.isArray(record.equipment)
    ? record.equipment.map(itemFromRecord).filter((item) => item != null)
    : [];
  const stats = Array.isArray(record.stats)
    ? record.stats.slice(0, COMBAT_SKILLS.length).map((level) =>
      Math.max(1, Math.floor(Number(level) || 1)))
    : [];
  if (stats.length !== COMBAT_SKILLS.length) {
    return null;
  }
  return new Presetable(
    name,
    inventory,
    equipment,
    stats,
    spellbookFromRecord(record),
    false,
    Number.isInteger(record.autocastSpellId) ? record.autocastSpellId : -1
  );
}

function presetRecord(preset) {
  return {
    name: preset.getName(),
    inventory: preset.getInventory().map(itemRecord).filter((item) => item != null),
    equipment: preset.getEquipment().map(itemRecord).filter((item) => item != null),
    stats: preset.getStats().map((level) => Math.max(1, Math.floor(Number(level) || 1))),
    spellbookId: preset.getSpellbook().getInterfaceId(),
    autocastSpellId: resolvePresetAutocastSpellId(preset),
  };
}

function customPresets(player) {
  const records = player?.getAttribute?.(CUSTOM_PRESETS_ATTRIBUTE);
  const presets = Array.isArray(records) ? records.map(presetFromRecord) : [];
  return Array.from({ length: MAX_PRESETS }, (_, index) => presets[index] ?? null);
}

function setCustomPreset(player, index, preset) {
  const records = Array.isArray(player.getAttribute(CUSTOM_PRESETS_ATTRIBUTE))
    ? [...player.getAttribute(CUSTOM_PRESETS_ATTRIBUTE)]
    : new Array(MAX_PRESETS).fill(null);
  records[index] = preset ? presetRecord(preset) : null;
  player.setAttribute(CUSTOM_PRESETS_ATTRIBUTE, records.slice(0, MAX_PRESETS));
}

function selectedCustomPresetSlot(player) {
  const slot = player.getAttribute(CUSTOM_PRESET_SLOT_ATTRIBUTE);
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_PRESETS ? slot : -1;
}

function captureCombatStats(player) {
  const skills = player.getSkillManager();
  return COMBAT_SKILLS.map((skill) => skills.getMaxLevel(skill));
}

function resolvePresetAutocastSpellId(preset) {
  const value =
    preset?.getAutocastSpellId?.() ??
    (Number.isInteger(preset?.autocastSpellId) ? preset.autocastSpellId : -1);
  return Number.isInteger(value) && value > 0 ? value : -1;
}

function applyPresetAutocastIfDefined(player, preset) {
  const autocastSpellId = resolvePresetAutocastSpellId(preset);
  if (autocastSpellId <= 0) {
    return;
  }

  try {
    const spell = CombatSpells.getCombatSpell(autocastSpellId);
    if (spell && spell.getSpellbook?.() === player.getSpellbook?.()) {
      Autocasting.setAutocast(player, spell);
    } else {
      Autocasting.setAutocast(player, null);
    }
  } catch (_error) {
    // Ignore invalid/missing spell ids for backwards compatibility with older saves.
    Autocasting.setAutocast(player, null);
  }
}

function getSpellbookDisplayName(spellbook) {
  const MagicSpellbook =
    require("../../../src/main/typescript/elvarg/game/model/MagicSpellbook").MagicSpellbook;
  if (spellbook === MagicSpellbook.ANCIENT) {
    return "Ancient";
  }
  if (spellbook === MagicSpellbook.LUNAR) {
    return "Lunar";
  }
  if (spellbook === MagicSpellbook.ARCEUUS) {
    return "Arceuus";
  }
  if (spellbook === MagicSpellbook.NORMAL) {
    return "Normal";
  }
  return "Normal";
}

function isPresetBlockedInWilderness(player) {
  return Wilderness.isIn(player) && !isFeroxSafeLocation(player?.getLocation?.()) && !isPlayerBot(player);
}

function renderPresetLists(player) {
  const sender = player.getPacketSender();
  const pool = getGlobalPresetPool();
  const presets = customPresets(player);
  const selected = player.getCurrentPreset?.() ?? null;
  for (let row = 0; row < PRESET_ROW_COUNT; row++) {
    const custom = row >= GLOBAL_ROW_COUNT;
    const preset = custom ? presets[row - GLOBAL_ROW_COUNT] : pool[row];
    const name = preset?.getName?.();
    const isSelected = custom
      ? row - GLOBAL_ROW_COUNT === selectedCustomPresetSlot(player)
      : preset === selected;
    sender.sendString(
      name
        ? `<col=${isSelected ? "ffffff" : "c5b79b"}>${name}</col>`
        : custom
          ? "<col=6f6355>Empty slot</col>"
          : "",
      uid(PRESET_ROW_START + row)
    );
  }
}

function renderButtons(player) {
  const sender = player.getPacketSender();
  const selected = player.getCurrentPreset?.() ?? null;
  const isCustom = selected != null && !selected.getIsGlobal?.();
  sender
    .sendString(
      shouldOpenOnDeath(player) ? "On death: <col=40ff40>on</col>" : "On death: <col=ff981f>off</col>",
      uid(COMPONENT.DEATH_BUTTON + 50)
    )
    .sendString("Load preset", uid(COMPONENT.LOAD_BUTTON + 50))
    .sendString(isCustom ? "Overwrite slot" : "Save current", uid(COMPONENT.SAVE_BUTTON + 50));
}

function renderSelectedPreset(player, preset) {
  const sender = player.getPacketSender();
  sender.sendString(preset?.getName?.() ?? "No preset selected", uid(COMPONENT.SELECTED_NAME));

  const stats = Array.isArray(preset?.getStats?.()) ? preset.getStats() : [];
  for (let index = 0; index < STAT_LABELS.length; index++) {
    const level = Number(stats[index]);
    const text = preset && Number.isFinite(level) ? String(Math.max(1, Math.floor(level))) : "";
    sender
      .sendString(text, uid(STAT_ROW_START + index))
      .sendString(text, uid(STAT_MAX_ROW_START + index));
  }
  sender.sendString(
    preset ? `Spellbook: <col=ffffff>${getSpellbookDisplayName(preset.getSpellbook())}</col>` : "",
    uid(COMPONENT.SPELLBOOK)
  );

  const inventory = Array.isArray(preset?.getInventory?.()) ? preset.getInventory() : [];
  for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
    const item = inventory[slot];
    sender.sendItemOnInterfaces(
      uid(INVENTORY_SLOT_START + slot),
      isValidItem(item) ? item.getId() : -1,
      isValidItem(item) ? item.getAmount() : 1
    );
  }

  for (const slot of EQUIPMENT_SLOTS) {
    sender.sendItemOnInterfaces(uid(EQUIPMENT_SLOT_START + slot), -1, 1);
    // An empty slot shows the cache's silhouette for that slot.
    sender.sendInterfaceDisplayState(uid(EQUIPMENT_PLACEHOLDER_START + slot), false);
  }
  const equipment = Array.isArray(preset?.getEquipment?.()) ? preset.getEquipment() : [];
  for (const item of equipment) {
    if (!isValidItem(item)) {
      continue;
    }
    const slot = equipmentSlotOf(item.getId());
    if (slot < 0) {
      continue;
    }
    sender.sendItemOnInterfaces(uid(EQUIPMENT_SLOT_START + slot), item.getId(), item.getAmount());
    sender.sendInterfaceDisplayState(uid(EQUIPMENT_PLACEHOLDER_START + slot), true);
  }
}

function selectPreset(player, preset, customSlot = -1) {
  player.setCurrentPreset(preset ?? null);
  player.setAttribute(CUSTOM_PRESET_SLOT_ATTRIBUTE, customSlot);
  renderPresetLists(player);
  renderSelectedPreset(player, preset ?? null);
  renderButtons(player);
}

function openPresetInterface(player, preset = null) {
  if (!player) {
    return false;
  }

  if (isPresetBlockedInWilderness(player)) {
    player.sendMessage("You can't open presets in the wilderness!");
    return false;
  }

  const sender = player.getPacketSender();
  player.setInterfaceId(GROUP_ID);
  sender.sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    // Script 227 is the frame script with the standard close button - the same widget
    // every other interface uses, hover and pressed states included. Its op closes the
    // interface client-side and the client tells us via IF_CLOSE.
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Presets"] }],
  });

  selectPreset(player, preset ?? null);
  return true;
}

function applyPreset(player, preset) {
  if (!player || !preset) {
    return false;
  }

  const sender = player.getPacketSender();

  if (isPresetInterfaceOpen(player)) {
    player.setInterfaceId(-1);
    sender.closeSubInterface(MAIN_MODAL_UID);
  }
  if (isPresetBlockedInWilderness(player)) {
    sender.sendMessage("You can't load a preset in the wilderness!");
    return false;
  }
  let movedToBank = false;
  const carriedItems = [
    ...player.getInventory().getCopiedItems(),
    ...player.getEquipment().getCopiedItems(),
  ];
  for (const item of carriedItems) {
    if (!isValidItem(item) || isSpawnable(item.getId())) {
      continue;
    }
    player.getBank(Bank.getTabForItem(player, item.getId())).add(item, false);
    movedToBank = true;
  }
  if (movedToBank) {
    sender.sendMessage(
      "The non-spawnable items you had on you have been sent to your bank."
    );
  }

  player.getInventory().resetItems().refreshItems();
  player.getEquipment().resetItems().refreshItems();

  if (!preset.getIsGlobal()) {
    const nonSpawnableRequirements = [];
    for (const item of [...(preset.getInventory() ?? []), ...(preset.getEquipment() ?? [])]) {
      if (!isValidItem(item) || isSpawnable(item.getId())) {
        continue;
      }
      nonSpawnableRequirements.push(item);

      const inventoryAmt = player.getInventory().getAmount(item.getId());
      const equipmentAmt = player.getEquipment().getAmount(item.getId());
      const bankAmt = player
        .getBank(Bank.getTabForItem(player, item.getId()))
        .getAmount(item.getId());
      const totalAmt = inventoryAmt + equipmentAmt + bankAmt;
      const presetAmt = preset.getAmount(item.getId());

      if (totalAmt < presetAmt) {
        sender.sendMessage(
          `You don't have the non-spawnable item ${item.getDefinition().getName()} in your inventory, equipment or bank.`
        );
        return false;
      }
    }

    for (const item of nonSpawnableRequirements) {
      if (player.getInventory().containsItem(item)) {
        player.getInventory().deletes(item);
      } else if (player.getEquipment().containsItem(item)) {
        player.getEquipment().deletes(item);
      } else {
        player
          .getBank(Bank.getTabForItem(player, item.getId()))
          .deletes(item);
      }
    }
  }

  for (const item of preset.getInventory() ?? []) {
    const next = cloneItem(item);
    if (!next) {
      continue;
    }
    player.getInventory().addItem(next);
  }

  for (const item of preset.getEquipment() ?? []) {
    const next = cloneItem(item);
    if (!next) {
      continue;
    }
    const slot = equipmentSlotOf(next.getId());
    if (slot < 0) {
      continue;
    }
    player.getEquipment().setItem(slot, next);
  }

  player.setSpellbook(preset.getSpellbook());
  applyPresetAutocastIfDefined(player, preset);

  let totalExp = 0;
  const presetStats = Array.isArray(preset.getStats()) ? preset.getStats() : [];
  for (let i = 0; i < COMBAT_SKILLS.length; i++) {
    const skill = COMBAT_SKILLS[i];
    const rawLevel = Number(presetStats[i]);
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.floor(rawLevel)) : 1;
    const exp = SkillManager.getExperienceForLevel(level);
    player
      .getSkillManager()
      .setCurrentLevels(skill, level)
      .setMaxLevel(skill, level)
      .setExperience(skill, exp);
    totalExp += exp;
  }

  sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
  sender.sendConfig(709, PrayerHandler.canUse(player, PrayerData.PRESERVE, false) ? 1 : 0);
  sender.sendConfig(711, PrayerHandler.canUse(player, PrayerData.RIGOUR, false) ? 1 : 0);
  sender.sendConfig(713, PrayerHandler.canUse(player, PrayerData.AUGURY, false) ? 1 : 0);

  player.resetAttributes();
  sender.sendMessage("Preset loaded!");
  sender.sendTotalExp(totalExp);

  player.setSpecialPercentage(100);
  CombatSpecial.updateBar(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

function applyRandomGlobalPreset(player, options = {}) {
  if (!player) {
    return null;
  }
  const preset = pickRandomGlobalPresetFromPool(options);
  if (!preset) {
    return null;
  }
  player.setCurrentPreset?.(preset);
  if (!applyPreset(player, preset)) {
    return null;
  }
  return preset;
}

/** Saves the player's current loadout into `index`, asking for a name first. */
function promptSavePreset(player, index) {
  player.setEnteredSyntaxAction({
    execute: (rawInput) => {
      const input = Misc.formatText(rawInput ?? "");
      if (!Misc.isValidName(input)) {
        player.sendMessage("Invalid name for preset.");
        player.setCurrentPreset(null);
        openPresetInterface(player, null);
        return;
      }

      const inventory = player.getInventory().copyValidItemsArray();
      const equipment = player.getEquipment().copyValidItemsArray();
      for (const item of [...inventory, ...equipment]) {
        if (item?.getDefinition?.()?.isNoted?.()) {
          player.sendMessage("You cannot create presets which contain noted items.");
          return;
        }
      }

      const preset = new Presetable(
        input,
        inventory,
        equipment,
        captureCombatStats(player),
        player.getSpellbook(),
        false,
        player.getCombat()?.getAutocastSpell?.()?.spellId?.() ?? -1
      );
      setCustomPreset(player, index, preset);
      selectPreset(player, preset, index);
    },
  });
  player
    .getPacketSender()
    .sendEnterInputPrompt("Enter a name for your preset below.");
}

function firstFreePresetSlot(player) {
  return customPresets(player).findIndex((preset) => preset == null);
}

function requireOpenInterface(player) {
  if (isPresetInterfaceOpen(player) || isPlayerBot(player)) {
    return true;
  }
  return false;
}

function handlePresetRowClick(player, buttonId) {
  if (!requireOpenInterface(player)) {
    return false;
  }

  const globalRow = GLOBAL_ROW_UIDS.indexOf(buttonId);
  if (globalRow >= 0) {
    const preset = getGlobalPresetPool()[globalRow] ?? null;
    if (!preset) {
      player.sendMessage("That preset is currently unavailable.");
      return true;
    }
    selectPreset(player, preset);
    return true;
  }

  const customRow = CUSTOM_ROW_UIDS.indexOf(buttonId);
  if (customRow >= 0) {
    const preset = customPresets(player)[customRow] ?? null;
    if (preset) {
      selectPreset(player, preset, customRow);
    } else {
      promptSavePreset(player, customRow);
    }
    return true;
  }

  return false;
}

function handlePresetActionButton(player, buttonId) {
  if (!requireOpenInterface(player)) {
    return false;
  }

  switch (buttonId) {
    case uid(COMPONENT.DEATH_BUTTON):
      player.setAttribute(OPEN_ON_DEATH_ATTRIBUTE, !shouldOpenOnDeath(player));
      renderButtons(player);
      return true;

    case uid(COMPONENT.LOAD_BUTTON): {
      const preset = player.getCurrentPreset();
      if (!preset) {
        player.sendMessage("You haven't selected any preset yet.");
        return true;
      }
      applyPreset(player, preset);
      return true;
    }

    case uid(COMPONENT.SAVE_BUTTON): {
      // Saving over a selected custom preset edits it in place; otherwise it fills the
      // first free slot, which is the only way to create one.
      const selected = player.getCurrentPreset();
      const selectedIndex = selected ? selectedCustomPresetSlot(player) : -1;
      const index = selectedIndex >= 0 ? selectedIndex : firstFreePresetSlot(player);
      if (index < 0) {
        player.sendMessage(`You already have ${MAX_PRESETS} presets. Select one to overwrite it.`);
        return true;
      }
      promptSavePreset(player, index);
      return true;
    }

    default:
      return handlePresetRowClick(player, buttonId);
  }
}

module.exports = {
  name: "Presets",
  applyPreset,
  applyRandomGlobalPreset,
  getGlobalPresetByName,
  getGlobalPresetByKey,
  getGlobalPresetPool,
  isEnabled: () => presetsEnabled,
  openPresetInterface,
  shouldOpenOnDeath,
  register(api) {
    presetsEnabled = true;
    api.persistAttribute(CUSTOM_PRESETS_ATTRIBUTE);
    api.registerCustomInterface(INTERFACE_DEFINITION);

    api.onInterfaceActionButton(PRESET_BUTTON_UIDS, ({ player, buttonId }) =>
      handlePresetActionButton(player, buttonId)
    );

  },
};

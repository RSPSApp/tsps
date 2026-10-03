const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { promisify } = require("util");
const { isBrowserHost } = require("./IndexedDbPersistenceHandoff");
const { PrayerData } = require("../../src/main/typescript/elvarg/game/content/PrayerHandler");
const { FightType } = require("../../src/main/typescript/elvarg/game/content/combat/FightType");
const { Skills } = require("../../src/main/typescript/elvarg/game/content/skill/SkillManager");
const { PlayerPersistence } = require("../../src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerPersistence");
const { PlayerSave } = require("../../src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerSave");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { MagicSpellbook } = require("../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { SkullType } = require("../../src/main/typescript/elvarg/game/model/SkullType");
const { DonatorRights } = require("../../src/main/typescript/elvarg/game/model/rights/DonatorRights");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

const openAsync = promisify(fs.open);
const writeFileAsync = promisify(fs.writeFile);
const fsyncAsync = promisify(fs.fsync);
const closeAsync = promisify(fs.close);

function isIgnorableFsyncError(error) {
  const code = error?.code;
  if (code === "ENOSYS" || code === "ENOTSUP" || code === "ERR_NOT_IMPLEMENTED") {
    return true;
  }
  const message = String(error?.message ?? "");
  return message.includes("Method not implemented");
}

async function fsyncDirectorySafeAsync(directoryPath) {
  let dirFd = null;
  try {
    dirFd = await openAsync(directoryPath, "r");
    await fsyncAsync(dirFd);
  } catch (error) {
    if (!isIgnorableFsyncError(error)) {
      // Directory fsync is best-effort and can be unsupported on some platforms/filesystems.
    }
  } finally {
    if (dirFd !== null) {
      try {
        await closeAsync(dirFd);
      } catch (_error) {
        // no-op
      }
    }
  }
}

async function fsyncFileSafeAsync(fd) {
  try {
    await fsyncAsync(fd);
  } catch (error) {
    if (!isIgnorableFsyncError(error)) {
      throw error;
    }
  }
}

async function writeFileAtomicallyAsync(filePath, content) {
  const directory = path.dirname(filePath);
  const tempFilePath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}.tmp`
  );
  let tempFd = null;
  try {
    tempFd = await openAsync(tempFilePath, "w");
    await writeFileAsync(tempFd, content, "utf8");
    await fsyncFileSafeAsync(tempFd);
  } finally {
    if (tempFd !== null) {
      try {
        await closeAsync(tempFd);
      } catch (_error) {
        // no-op
      }
    }
  }

  await fsp.rename(tempFilePath, filePath);
  await fsyncDirectorySafeAsync(directory);
}

class JsonPlayerPersistence extends PlayerPersistence {
  static SAVE_DIRECTORY = path.join(
    process.cwd(),
    "data",
    "saves",
    "characters"
  );

  constructor() {
    super();
    this.prayerByConfig = new Map();
    this.pendingSerializedSaves = new Map();
    this.failedWrites = new Map();
    this.pendingWriteChain = Promise.resolve();
    this.nextWriteSequence = 0;
    for (const prayer of PrayerData.values()) {
      this.prayerByConfig.set(prayer.configId, prayer);
    }
  }

  load(username) {
    const filePath = this.resolveFilePath(username);
    const pendingWrite = this.pendingSerializedSaves.get(filePath);
    if (pendingWrite) {
      const parsed = JSON.parse(pendingWrite.serialized, this.reviver.bind(this));
      return this.hydratePlayerSave(parsed);
    }
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const rawJson = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawJson, this.reviver.bind(this));
    return this.hydratePlayerSave(parsed);
  }

  save(player) {
    if (!player || !player.getUsername()) {
      return;
    }

    const save = PlayerSave.fromPlayer(player);
    const serialized = JSON.stringify(save, this.replacer.bind(this), 2);
    this.validateSerializedSave(serialized, player.getUsername());
    const filePath = this.resolveFilePath(player.getUsername());
    this.enqueueSerializedWrite(filePath, serialized, player.getUsername());
  }

  exists(username) {
    const filePath = this.resolveFilePath(username);
    return this.pendingSerializedSaves.has(filePath) || fs.existsSync(filePath);
  }

  async flush() {
    await this.pendingWriteChain.catch(() => undefined);
    if (this.failedWrites.size > 0) {
      throw this.failedWrites.values().next().value;
    }
  }

  resolveFilePath(username) {
    const normalized = this.normalizeUsername(username);
    return path.join(JsonPlayerPersistence.SAVE_DIRECTORY, `${normalized}.json`);
  }

  normalizeUsername(username) {
    const formatted = Misc.formatPlayerName((username ?? "").trim().toLowerCase());
    const safe = formatted
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return safe.length > 0 ? safe.toLowerCase() : "player";
  }

  enqueueSerializedWrite(filePath, serialized, username) {
    const sequence = ++this.nextWriteSequence;
    this.pendingSerializedSaves.set(filePath, { sequence, serialized });
    this.pendingWriteChain = this.pendingWriteChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await fsp.mkdir(path.dirname(filePath), { recursive: true });
          await writeFileAtomicallyAsync(filePath, serialized);
          const pendingWrite = this.pendingSerializedSaves.get(filePath);
          if (pendingWrite && pendingWrite.sequence === sequence) {
            this.pendingSerializedSaves.delete(filePath);
          }
          this.failedWrites.delete(filePath);
        } catch (error) {
          this.failedWrites.set(filePath, error);
          console.error(`[persistence] async save failed for ${username}`, error);
        }
      });
  }

  replacer(_key, value) {
    if (value instanceof Map) {
      return {
        __type: "Map",
        entries: Array.from(value.entries()),
      };
    }
    return value;
  }

  reviver(_key, value) {
    if (
      value &&
      typeof value === "object" &&
      value.__type === "Map" &&
      Array.isArray(value.entries)
    ) {
      return new Map(value.entries);
    }
    return value;
  }

  hydratePlayerSave(raw) {
    const parsed = raw && typeof raw === "object" ? raw : {};

    const save = Object.assign(
      new PlayerSave(),
      {
        passwordHashWithSalt: "",
        isDiscordLogin: false,
        cachedDiscordAccessToken: "",
        autoRetaliate: true,
        hasVengeance: false,
        lastVengeanceTimer: 0,
        specPercentage: 100,
        poisonDamage: 0,
        barrowsCrypt: 0,
        barrowsChests: 0,
        killedBrothers: [],
        gwdKills: [],
        poisonImmunityTimer: 0,
        fireImmunityTimer: 0,
        teleblockTimer: 0,
        specialAttackRestoreTimer: 0,
        skullTimer: 0,
        running: false,
        runEnergy: 100,
        inventory: [],
        equipment: [],
        appearance: [],
        friends: [],
        ignores: [],
        flags: [],
      },
      parsed
    );

    save.position = this.hydrateLocation(parsed.position);
    save.rights = this.hydrateRights(parsed.rights);
    save.donatorRights = this.hydrateDonatorRights(parsed.donatorRights);
    save.spellBook = this.hydrateSpellbook(parsed.spellBook);
    save.fightType = FightType.UNARMED_KICK;
    save.skullType = this.hydrateSkullType(parsed.skullType);
    save.inventory = this.hydrateItems(parsed.inventory, 28);
    save.equipment = this.hydrateItems(parsed.equipment, 14);
    save.skills = this.hydrateSkills(parsed.skills);
    save.quickPrayers = this.hydrateQuickPrayers(parsed.quickPrayers);
    save.friends = this.hydrateRelationArray(parsed.friends, { max: 200 });
    save.ignores = this.hydrateRelationArray(parsed.ignores, { max: 100 });
    save.flags = this.hydrateFlags(parsed.flags);
    save.banks = this.hydrateBanks(parsed.banks);
    return save;
  }

  hydrateLocation(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const x = this.toNumber(value.x, 3089);
    const y = this.toNumber(value.y, 3524);
    const z = this.toNumber(value.z ?? value.plane, 0);
    return new Location(x, y, z);
  }

  hydrateRights(raw) {
    const numericId = this.toNumber(raw, Number.NaN);
    if (!Number.isNaN(numericId)) {
      return PlayerRights.fromId(numericId);
    }
    const id = this.toNumber(raw?.id, Number.NaN);
    if (!Number.isNaN(id)) {
      return PlayerRights.fromId(id);
    }
    const spriteId = this.toNumber(raw?.spriteId, -1);
    return PlayerRights.fromSpriteId(spriteId);
  }

  hydrateDonatorRights(raw) {
    const numericId = this.toNumber(raw, Number.NaN);
    if (!Number.isNaN(numericId)) {
      return DonatorRights.fromId(numericId);
    }
    const id = this.toNumber(raw?.id, Number.NaN);
    if (!Number.isNaN(id)) {
      return DonatorRights.fromId(id);
    }
    const spriteId = this.toNumber(raw?.spriteId, -1);
    return DonatorRights.fromSpriteId(spriteId);
  }

  hydrateSpellbook(raw) {
    const interfaceId = this.toNumber(raw?.interfaceId, 1151);
    if (interfaceId === MagicSpellbook.ANCIENT.getInterfaceId()) {
      return MagicSpellbook.ANCIENT;
    }
    if (interfaceId === MagicSpellbook.LUNAR.getInterfaceId()) {
      return MagicSpellbook.LUNAR;
    }
    if (interfaceId === MagicSpellbook.ARCEUUS.getInterfaceId()) {
      return MagicSpellbook.ARCEUUS;
    }
    return MagicSpellbook.NORMAL;
  }

  hydrateSkullType(raw) {
    const iconId = this.toNumber(raw?.iconId, 0);
    return iconId === SkullType.RED_SKULL.getIconId()
      ? SkullType.RED_SKULL
      : SkullType.WHITE_SKULL;
  }

  hydrateSkills(raw) {
    const skills = this.defaultSkills();
    if (!raw || typeof raw !== "object") {
      return skills;
    }

    skills.level = this.mergeSkillArray(raw.level, skills.level);
    skills.maxLevel = this.mergeSkillArray(raw.maxLevel, skills.maxLevel);
    skills.experience = this.mergeSkillArray(raw.experience, skills.experience);
    return skills;
  }

  defaultSkills() {
    const skills = new Skills();
    const total = SkillManager.AMOUNT_OF_SKILLS;
    skills.level = new Array(total).fill(1);
    skills.maxLevel = new Array(total).fill(1);
    skills.experience = new Array(total).fill(0);
    const hp = Skill.HITPOINTS.getIndex();
    skills.level[hp] = 10;
    skills.maxLevel[hp] = 10;
    skills.experience[hp] = 1184;
    return skills;
  }

  hydrateQuickPrayers(raw) {
    const allPrayers = Array.from(PrayerData.values());
    if (!Array.isArray(raw)) {
      return Array.from({ length: allPrayers.length }, () => null);
    }
    const prayers = raw.map((entry) => this.resolvePrayer(entry));
    while (prayers.length < allPrayers.length) {
      prayers.push(null);
    }
    return prayers.slice(0, allPrayers.length);
  }

  resolvePrayer(raw) {
    if (raw == null) {
      return null;
    }

    const configId = this.toNumber(raw?.configId, Number.NaN);
    if (!Number.isNaN(configId)) {
      const prayer = this.prayerByConfig.get(configId);
      if (prayer) {
        return prayer;
      }
    }
    return null;
  }

  hydrateItems(raw, expectedLength) {
    const items = Array.isArray(raw)
      ? raw.map((entry) => this.hydrateItem(entry))
      : [];

    if (expectedLength == null) {
      return items;
    }

    if (items.length > expectedLength) {
      return items.slice(0, expectedLength);
    }
    while (items.length < expectedLength) {
      items.push(new Item(-1, 0));
    }
    return items;
  }

  hydrateItem(raw) {
    if (raw instanceof Item) {
      return raw;
    }
    const value = raw && typeof raw === "object" ? raw : {};
    const id = this.toNumber(value.id, -1);
    const amount = this.toNumber(value.amount, id > 0 ? 1 : 0);
    const meta =
      value.meta && typeof value.meta === "object" && !Array.isArray(value.meta)
        ? Item.cloneMeta(value.meta)
        : null;
    return new Item(id, amount, meta);
  }

  hydrateBanks(raw) {
    const banks = new Map();
    for (const [key, value] of this.entriesFrom(raw)) {
      const index = this.toNumber(key, -1);
      if (index < 0) {
        continue;
      }
      banks.set(index, this.hydrateItems(value));
    }
    return banks;
  }

  entriesFrom(raw) {
    if (raw instanceof Map) {
      return Array.from(raw.entries());
    }
    if (Array.isArray(raw)) {
      return raw.filter((entry) => Array.isArray(entry) && entry.length === 2);
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw);
    }
    return [];
  }

  hydrateNumberArray(raw, options = {}) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const max = Number.isInteger(options.max) ? options.max : Number.MAX_SAFE_INTEGER;
    const out = [];
    const seen = new Set();
    for (const value of raw) {
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric) || numeric <= 0 || seen.has(numeric)) {
        continue;
      }
      seen.add(numeric);
      out.push(numeric);
      if (out.length >= max) {
        break;
      }
    }
    return out;
  }

  hydrateRelationArray(raw, options = {}) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const max = Number.isInteger(options.max) ? options.max : Number.MAX_SAFE_INTEGER;
    const out = [];
    const seen = new Set();
    for (const value of raw) {
      let normalized;
      try {
        const asBigInt =
          typeof value === "bigint"
            ? value
            : BigInt(String(value ?? "").trim());
        if (asBigInt <= 0n) {
          continue;
        }
        normalized = asBigInt.toString();
      } catch {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= max) {
        break;
      }
    }
    return out;
  }

  hydrateStringArray(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((value) => String(value ?? ""));
  }

  hydrateFlags(raw) {
    const out = [];
    const seen = new Set();
    for (const value of this.hydrateStringArray(raw)) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  mergeNumberArray(raw, fallback) {
    const output = fallback.slice();
    if (!Array.isArray(raw)) {
      return output;
    }
    const length = Math.min(raw.length, output.length);
    for (let index = 0; index < length; index++) {
      output[index] = this.toNumber(raw[index], output[index]);
    }
    return output;
  }

  mergeSkillArray(raw, fallback) {
    if (!Array.isArray(raw)) {
      return fallback.slice();
    }

    // Backward compatibility: older saves used skill button ids (e.g. 8655)
    // as array indices, producing very large sparse arrays.
    if (this.isLegacyButtonIndexedSkillArray(raw)) {
      const output = fallback.slice();
      for (const skill of Skill.values()) {
        output[skill.getIndex()] = this.toNumber(
          raw[skill.getButton()],
          output[skill.getIndex()]
        );
      }
      return output;
    }

    return this.mergeNumberArray(raw, fallback);
  }

  isLegacyButtonIndexedSkillArray(raw) {
    if (!Array.isArray(raw) || raw.length <= SkillManager.AMOUNT_OF_SKILLS) {
      return false;
    }
    return Skill.values().some((skill) => raw[skill.getButton()] != null);
  }

  toNumber(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  validateSerializedSave(serialized, username) {
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new Error(
        `Refusing to save invalid JSON for ${username}: ${error?.message ?? error}`
      );
    }

    const assertFiniteNumber = (value, pathLabel) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `Refusing to save ${username}: ${pathLabel} must be a finite number`
        );
      }
    };

    const assertObject = (value, pathLabel) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Refusing to save ${username}: ${pathLabel} must be an object`);
      }
    };

    const assertItemArray = (value, expectedLength, pathLabel) => {
      if (!Array.isArray(value) || value.length !== expectedLength) {
        throw new Error(
          `Refusing to save ${username}: ${pathLabel} must be an array of length ${expectedLength}`
        );
      }
      for (let i = 0; i < value.length; i++) {
        const entry = value[i];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error(
            `Refusing to save ${username}: ${pathLabel}[${i}] must be an object`
          );
        }
        assertFiniteNumber(entry.id, `${pathLabel}[${i}].id`);
        assertFiniteNumber(entry.amount, `${pathLabel}[${i}].amount`);
      }
    };

    const assertNumericArray = (value, expectedLength, pathLabel) => {
      if (!Array.isArray(value) || value.length !== expectedLength) {
        throw new Error(
          `Refusing to save ${username}: ${pathLabel} must be an array of length ${expectedLength}`
        );
      }
      for (let i = 0; i < value.length; i++) {
        assertFiniteNumber(value[i], `${pathLabel}[${i}]`);
      }
    };

    assertObject(parsed, "root");
    assertObject(parsed.position, "position");
    assertFiniteNumber(parsed.position.x, "position.x");
    assertFiniteNumber(parsed.position.y, "position.y");
    assertFiniteNumber(parsed.position.z, "position.z");

    assertItemArray(parsed.inventory, 28, "inventory");
    assertItemArray(parsed.equipment, 14, "equipment");

    assertObject(parsed.skills, "skills");
    assertNumericArray(parsed.skills.level, SkillManager.AMOUNT_OF_SKILLS, "skills.level");
    assertNumericArray(parsed.skills.maxLevel, SkillManager.AMOUNT_OF_SKILLS, "skills.maxLevel");
    assertNumericArray(
      parsed.skills.experience,
      SkillManager.AMOUNT_OF_SKILLS,
      "skills.experience"
    );
  }
}

let SkillManager;

module.exports = {
  name: "JsonPlayerPersistence",
  register(api) {
    SkillManager = api.getSkillManager();
    if (isBrowserHost()) {
      return;
    }
    api.setPlayerPersistence(new JsonPlayerPersistence());
    api.log("registered", {
      saveDirectory: path.join("data", "saves", "characters"),
    });
  },
  JsonPlayerPersistence,
};

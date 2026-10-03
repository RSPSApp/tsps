const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
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

function legacyJsonImportEnabled() {
  const value = String(process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON ?? "0")
    .trim()
    .toLowerCase();
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

class SqlitePlayerPersistence extends PlayerPersistence {
  static LEGACY_SAVE_DIRECTORY = process.env.LEGACY_PLAYER_SAVE_DIRECTORY
    ? path.resolve(process.env.LEGACY_PLAYER_SAVE_DIRECTORY)
    : path.join(process.cwd(), "data", "saves", "characters");
  static DATABASE_PATH = process.env.PLAYER_SAVE_DATABASE_PATH
    ? path.resolve(process.env.PLAYER_SAVE_DATABASE_PATH)
    : path.join(process.cwd(), "data", "saves", "players.sqlite");
  static IMPORT_LEGACY_JSON = legacyJsonImportEnabled();

  constructor() {
    super();
    this.prayerByConfig = new Map();
    for (const prayer of PrayerData.values()) {
      this.prayerByConfig.set(prayer.configId, prayer);
    }

    fs.mkdirSync(path.dirname(SqlitePlayerPersistence.DATABASE_PATH), { recursive: true });
    this.database = new DatabaseSync(SqlitePlayerPersistence.DATABASE_PATH);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS player_saves (
        username TEXT PRIMARY KEY,
        save_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.findSave = this.database.prepare(
      "SELECT save_json AS saveJson FROM player_saves WHERE username = ?"
    );
    this.savePlayer = this.database.prepare(`
      INSERT INTO player_saves (username, save_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        save_json = excluded.save_json,
        updated_at = excluded.updated_at
    `);
    if (SqlitePlayerPersistence.IMPORT_LEGACY_JSON) {
      this.importLegacySaves();
    } else {
      console.debug("[persistence] legacy JSON import is disabled");
    }
  }

  load(username) {
    const row = this.findSave.get(this.normalizeUsername(username));
    if (!row || typeof row.saveJson !== "string") {
      return null;
    }
    const parsed = JSON.parse(row.saveJson, this.reviver.bind(this));
    return this.hydratePlayerSave(parsed);
  }

  save(player) {
    if (!player || !player.getUsername()) {
      return;
    }

    const save = PlayerSave.fromPlayer(player);
    const serialized = JSON.stringify(save, this.replacer.bind(this), 2);
    this.validateSerializedSave(serialized, player.getUsername());
    this.savePlayer.run(
      this.normalizeUsername(player.getUsername()),
      serialized,
      new Date().toISOString()
    );
  }

  exists(username) {
    return this.findSave.get(this.normalizeUsername(username)) !== undefined;
  }

  normalizeUsername(username) {
    const formatted = Misc.formatPlayerName((username ?? "").trim().toLowerCase());
    const safe = formatted
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return safe.length > 0 ? safe.toLowerCase() : "player";
  }

  /**
   * Copies every legacy character file into SQLite without ever overwriting an
   * existing row. The original JSON files remain in place as a rollback backup.
   */
  importLegacySaves() {
    const directory = SqlitePlayerPersistence.LEGACY_SAVE_DIRECTORY;
    if (!fs.existsSync(directory)) {
      return;
    }

    const insertLegacySave = this.database.prepare(`
      INSERT INTO player_saves (username, save_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO NOTHING
    `);
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
      .map((entry) => entry.name)
      .sort();
    let imported = 0;
    let skipped = 0;
    let invalid = 0;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updatedAt = new Date().toISOString();
      for (const fileName of files) {
        const username = this.normalizeUsername(path.basename(fileName, ".json"));
        const filePath = path.join(directory, fileName);
        let serialized;
        try {
          serialized = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(serialized, this.reviver.bind(this));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("root must be an object");
          }
        } catch (error) {
          invalid++;
          console.warn(
            `[persistence] skipped invalid legacy save ${fileName}: ${error?.message ?? error}`
          );
          continue;
        }

        const result = insertLegacySave.run(username, serialized, updatedAt);
        if (result.changes === 1) {
          imported++;
        } else {
          skipped++;
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch (_rollbackError) {
        // The import error is more useful than a rollback error.
      }
      throw error;
    }

    if (files.length > 0) {
      console.info(
        `[persistence] SQLite imported ${imported} legacy save(s); existing=${skipped}, invalid=${invalid}`
      );
    }
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
  name: "SqlitePlayerPersistence",
  register(api) {
    SkillManager = api.getSkillManager();
    const persistence = new SqlitePlayerPersistence();
    api.setPlayerPersistence(persistence);
    api.log("registered", {
      databasePath: path.relative(process.cwd(), SqlitePlayerPersistence.DATABASE_PATH),
      legacySaveDirectory: path.relative(
        process.cwd(),
        SqlitePlayerPersistence.LEGACY_SAVE_DIRECTORY
      ),
      legacyJsonImportEnabled: SqlitePlayerPersistence.IMPORT_LEGACY_JSON,
    });
  },
};

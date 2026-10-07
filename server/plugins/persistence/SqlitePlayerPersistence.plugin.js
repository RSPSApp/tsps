const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { Worker } = require("worker_threads");
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
const { SqliteSaveHistory, PRE_ROLLBACK_REASON, ROLLBACK_REASON } = require("./SqliteSaveHistory");
const { createWriter } = require("./SqliteSaveWorker");

/** Writer threads that die before they're ready, in a row, before saves fall back to the game thread. */
const MAX_WRITER_FAILURES = 3;

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
    // This connection only reads once the writer starts (SqliteSaveWorker.js owns the writes).
    this.history = new SqliteSaveHistory(this.database);
    this.markInUse();
    /** Restores waiting for an online player's next save: username -> { json, recorded }. */
    this.pendingRestores = new Map();
    if (SqlitePlayerPersistence.IMPORT_LEGACY_JSON) {
      this.importLegacySaves();
    } else {
      console.debug("[persistence] legacy JSON import is disabled");
    }
    /** Saves sent to the writer and not yet committed: username -> { seq, json }. Loads read these first. */
    this.unwritten = new Map();
    /** Messages the writer hasn't answered, by seq, to resend if it dies. */
    this.inFlight = new Map();
    this.failedWrites = new Map();
    this.idleWaiters = [];
    this.sequence = 0;
    this.writerFailures = 0;
    this.writeHere = null;
    this.startWriter();
  }

  /**
   * Starts the writer thread. It is only kept referenced while it has work, so an idle writer
   * doesn't hold the process open. If it dies, a new one gets every unanswered message again;
   * if it keeps dying before it's ready, saves are written on the game thread instead.
   */
  startWriter() {
    const writer = new Worker(path.join(__dirname, "SqliteSaveWorker.js"), {
      workerData: { databasePath: SqlitePlayerPersistence.DATABASE_PATH, skillCount: SkillManager.AMOUNT_OF_SKILLS },
    });
    this.writer = writer;
    writer.on("message", (answer) => {
      if (answer.ready) this.writerFailures = 0;
      else this.onWritten(answer);
    });
    writer.on("error", (error) => console.error("[persistence] SQLite save writer failed", error));
    writer.on("exit", (code) => {
      if (this.writer !== writer) return;
      this.writerFailures++;
      if (this.writerFailures >= MAX_WRITER_FAILURES) {
        console.error(`[persistence] SQLite save writer keeps failing (exit ${code}); writing saves on the game thread`);
        this.writeHere = createWriter(this.database, SkillManager.AMOUNT_OF_SKILLS);
        this.writer = null;
        for (const message of [...this.inFlight.values()]) this.onWritten(this.writeHere(message));
        return;
      }
      console.error(`[persistence] SQLite save writer exited (${code}); restarting it with ${this.inFlight.size} unwritten save(s)`);
      this.startWriter();
      for (const message of this.inFlight.values()) this.writer.postMessage(message);
    });
    if (this.inFlight.size === 0) writer.unref();
  }

  /** Sends one player's writes to the writer; a row write is what load() returns until it's committed. */
  enqueue(username, writes) {
    const seq = ++this.sequence;
    const message = { seq, username, savedAt: new Date().toISOString(), writes };
    const row = writes.find((write) => write.kind === "row");
    if (row) this.unwritten.set(username, { seq, json: row.json });
    this.inFlight.set(seq, message);
    if (this.writeHere) {
      this.onWritten(this.writeHere(message));
      return;
    }
    if (this.inFlight.size === 1) this.writer.ref();
    this.writer.postMessage(message);
  }

  onWritten({ seq, username, ok, error }) {
    this.inFlight.delete(seq);
    if (this.unwritten.get(username)?.seq === seq) this.unwritten.delete(username);
    if (ok) {
      this.failedWrites.delete(username);
    } else {
      // Nothing of this save was written: the player's previous save stays.
      console.error(`[persistence] Failed to save ${username}: ${error}`);
      this.failedWrites.set(username, new Error(error));
    }
    if (this.inFlight.size === 0) {
      this.writer?.unref();
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  /** Waits until the writer has committed everything sent so far (shutdown awaits this). */
  async flush() {
    if (this.inFlight.size > 0) await new Promise((resolve) => this.idleWaiters.push(resolve));
    if (this.failedWrites.size > 0) throw this.failedWrites.values().next().value;
  }

  /** The player's newest save JSON: one waiting for the writer, else the stored one. */
  currentJson(username) {
    return this.unwritten.get(username)?.json ?? this.findSave.get(username)?.saveJson;
  }

  load(username) {
    // Logging back in after a rollback: the restored save is in place.
    this.pendingRestores.delete(this.normalizeUsername(username));
    const json = this.currentJson(this.normalizeUsername(username));
    if (typeof json !== "string") {
      return null;
    }
    const parsed = JSON.parse(json, this.reviver.bind(this));
    return this.hydratePlayerSave(parsed);
  }

  /**
   * Writes the player's save and, for a real player, a copy in the save history. A player with a
   * restore waiting (rolled back while online) gets the restored save instead, until they log
   * back in; their own state goes in the history first as "pre-rollback". Only the JSON is made
   * here, on the tick: the writer thread validates and stores it.
   */
  save(player, reason = "save") {
    if (!player || !player.getUsername()) {
      return;
    }

    const username = this.normalizeUsername(player.getUsername());
    const save = PlayerSave.fromPlayer(player);
    const serialized = JSON.stringify(save, this.replacer.bind(this));
    const pending = this.pendingRestores.get(username);
    if (pending) {
      const writes = pending.recorded ? [] : [{ kind: "history", json: serialized, reason: PRE_ROLLBACK_REASON }];
      pending.recorded = true;
      this.enqueue(username, [...writes, { kind: "row", json: pending.json }, { kind: "history", json: pending.json, reason: ROLLBACK_REASON }]);
      return;
    }
    const keepHistory = player.isPlayerBot?.() !== true;
    this.enqueue(username, [{ kind: "row", json: serialized }, ...(keepHistory ? [{ kind: "history", json: serialized, reason }] : [])]);
  }

  /**
   * Writes `<database>.pid` while this server has the database open, so the rollback script
   * (scripts/rollback-saves.mjs) can refuse to run under it.
   */
  markInUse() {
    const pidFile = `${SqlitePlayerPersistence.DATABASE_PATH}.pid`;
    fs.writeFileSync(pidFile, String(process.pid));
    process.once("exit", () => {
      try {
        if (fs.readFileSync(pidFile, "utf8") === String(process.pid)) fs.unlinkSync(pidFile);
      } catch {
        // Already gone.
      }
    });
  }

  supportsHistory() {
    return true;
  }

  listSnapshots(username, limit = 15) {
    return this.history.list(this.normalizeUsername(username), limit);
  }

  /** See PlayerPersistence.restoreSnapshot. An offline player's current save goes in the history first. */
  restoreSnapshot(username, id, { online = false } = {}) {
    const name = this.normalizeUsername(username);
    const copy = this.history.get(name, id);
    if (!copy) return null;
    if (online) {
      this.pendingRestores.set(name, { json: copy.json, recorded: false });
      return { snapshot: copy.snapshot, pending: true };
    }
    const current = this.currentJson(name);
    this.enqueue(name, [
      ...(typeof current === "string" ? [{ kind: "history", json: current, reason: PRE_ROLLBACK_REASON }] : []),
      { kind: "row", json: copy.json },
      { kind: "history", json: copy.json, reason: ROLLBACK_REASON },
    ]);
    return { snapshot: copy.snapshot, pending: false };
  }

  exists(username) {
    const name = this.normalizeUsername(username);
    return this.unwritten.has(name) || this.findSave.get(name) !== undefined;
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

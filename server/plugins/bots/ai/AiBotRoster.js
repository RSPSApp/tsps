"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Who the AI bots are, kept in data/saves/ai-bots.json (plugins have no world store, as for
 * the Gauntlet and Doom scoreboards): name, persona, provider, notes and where each logged
 * out. Their levels and items are in their normal player saves.
 */
const DEFAULT_FILE = path.join(process.cwd(), "data", "saves", "ai-bots.json");
const MAX_NOTES = 12;
const MAX_NOTE_LENGTH = 120;
const SAVE_DELAY_MS = 2000;

class AiBotRoster {
  constructor(file = DEFAULT_FILE) {
    this.file = file;
    this.bots = [];
    this.saveTimer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      this.bots = Array.isArray(raw?.bots) ? raw.bots.filter((bot) => typeof bot?.name === "string") : [];
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(`[ai bots] could not read ${file}; starting a new roster`, error);
      }
    }
  }

  has(name) {
    const key = String(name).toLowerCase();
    return this.bots.some((bot) => bot.name.toLowerCase() === key);
  }

  get(name) {
    const key = String(name).toLowerCase();
    return this.bots.find((bot) => bot.name.toLowerCase() === key) ?? null;
  }

  add(entry) {
    const bot = { notes: [], location: null, createdAt: new Date().toISOString(), ...entry };
    this.bots.push(bot);
    this.save();
    return bot;
  }

  /** Adds a note, dropping the oldest past MAX_NOTES. */
  remember(name, note) {
    const bot = this.get(name);
    const text = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);
    if (!bot || !text) return false;
    bot.notes = [...(bot.notes ?? []), text].slice(-MAX_NOTES);
    this.save();
    return true;
  }

  setLocation(name, location) {
    const bot = this.get(name);
    if (!bot || !location) return;
    bot.location = { x: location.getX(), y: location.getY(), z: location.getZ() };
    this.save();
  }

  /** Coalesces writes; `now` writes straight away (shutdown). */
  save(now = false) {
    if (now) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.write();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify({ bots: this.bots }, null, 2)}\n`);
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.error(`[ai bots] could not write ${this.file}`, error);
    }
  }
}

module.exports = { AiBotRoster, MAX_NOTES, MAX_NOTE_LENGTH };

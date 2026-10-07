/**
 * data/definitions/achievement-diaries.json, loaded once: the diaries by key, by diary tab row
 * and by reward NPC, and where each task lives.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");

const TIERS = ["easy", "medium", "hard", "elite"];

const DATA = JSON.parse(
  fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "achievement-diaries.json"), "utf8"),
);
const DIARIES = DATA.diaries;
const BY_KEY = new Map(DIARIES.map((diary) => [diary.key, diary]));
const BY_INDEX = new Map(DIARIES.map((diary) => [diary.index, diary]));
const BY_NPC = new Map(DIARIES.map((diary) => [diary.npc, diary]));
const LAMPS = new Map(Object.entries(DATA.lamps).map(([id, lamp]) => [Number(id), lamp]));

/** The tier a task belongs to, or null. */
function tierOfTask(diary, taskKey) {
  return TIERS.find((tier) => diary.tiers[tier].tasks.some((task) => task.key === taskKey)) ?? null;
}

/** A task's text on one line, for messages and the command. */
function taskText(task) {
  return task.lines.join(" ");
}

module.exports = { TIERS, DIARIES, BY_KEY, BY_INDEX, BY_NPC, LAMPS, tierOfTask, taskText };

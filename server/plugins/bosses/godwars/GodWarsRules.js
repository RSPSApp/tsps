"use strict";

// Pure access rules, kept free of game objects so an existing smoke can assert them.
const REQUIRED_KILL_COUNT = 40;
const TROLL_STRONGHOLD_DAD_STAGE = 20;

function canMoveBoulder(questStage, strength, agility) {
  if (!Number.isFinite(questStage) || questStage < TROLL_STRONGHOLD_DAD_STAGE) {
    return {
      ok: false,
      reason: "You need to have helped the Troll Stronghold before venturing further.",
    };
  }
  if (strength < 60 && agility < 60) {
    return {
      ok: false,
      reason: "You need a Strength or Agility level of 60 to move this boulder.",
    };
  }
  return { ok: true };
}

function canClimbEntrance(questStage, hasRope, roped) {
  if (!Number.isFinite(questStage) || questStage < TROLL_STRONGHOLD_DAD_STAGE) {
    return {
      ok: false,
      reason: "You need to have helped the Troll Stronghold before venturing down there.",
    };
  }
  if (roped) {
    return { ok: true, tiesRope: false };
  }
  if (!hasRope) {
    return { ok: false, reason: "You need a rope to climb down this hole." };
  }
  return { ok: true, tiesRope: true };
}

function canOpenBossDoor(input) {
  if (!input.hasGodItem) {
    return {
      ok: false,
      reason: "You need to wear an item aligned to that god to pass this door.",
    };
  }
  if (input.hasKey) {
    return { ok: true, consumesKey: true };
  }
  const required = input.required ?? REQUIRED_KILL_COUNT;
  if (input.killCount < required) {
    return {
      ok: false,
      reason: `You need ${required} essence from that god's followers to enter.`,
    };
  }
  return { ok: true };
}

module.exports = {
  REQUIRED_KILL_COUNT,
  TROLL_STRONGHOLD_DAD_STAGE,
  canMoveBoulder,
  canClimbEntrance,
  canOpenBossDoor,
};

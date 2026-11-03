"use strict";

/**
 * Brimhaven Agility Arena, under Brimhaven: pay Cap'n Izzy 200 coins, cross the obstacles and
 * tag the pillar the flashing arrow marks for an Agility arena ticket and a Brimhaven voucher. One dispenser
 * (of 24) is active at a time for a minute; the cycle is world-wide. Units live in
 * ./brimhavenagilityarena/.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Brimhaven_Agility_Arena
 */

const Shared = require("./brimhavenagilityarena/Shared.BrimhavenAgilityArena");
const Area = require("./brimhavenagilityarena/Area.BrimhavenAgilityArena");
const Dispensers = require("./brimhavenagilityarena/Dispensers.BrimhavenAgilityArena");
const Obstacles = require("./brimhavenagilityarena/Obstacles.BrimhavenAgilityArena");
const Store = require("./brimhavenagilityarena/Store.BrimhavenAgilityArena");

module.exports = {
  name: "BrimhavenAgilityArena",
  members: true,
  _test: {
    init: Shared.init,
    cycle: Shared.cycle,
    sessions: Shared.sessions,
    stateOf: Shared.stateOf,
    hasSession: Shared.hasSession,
    clearState: Shared.clearState,
    tick: Shared.tick,
    advanceCycle: Shared.advanceCycle,
    activeTile: Shared.activeTile,
    setRandom: Shared.setRandom,
    tagXp: Shared.tagXp,
    trapDamage: Shared.trapDamage,
    trapAt: Shared.trapAt,
    trapSpanAt: Shared.trapSpanAt,
    TRAP_SPANS: Shared.TRAP_SPANS,
    addObstacleXp: Shared.addObstacleXp,
    LAPS_ATTRIBUTE: Shared.LAPS_ATTRIBUTE,
    successChance: Shared.successChance,
    isInArena: Shared.isInArena,
    agilityLevel: Shared.agilityLevel,
    CYCLE_TICKS: Shared.CYCLE_TICKS,
    DISPENSER_TILES: Shared.DISPENSER_TILES,
    OBSTACLE_IDS: Shared.OBSTACLE_IDS,
    OBSTACLE_XP: Shared.OBSTACLE_XP,
    OBSTACLE_LEVEL: Shared.OBSTACLE_LEVEL,
    ENTRY: Shared.ENTRY,
    HUT: Shared.HUT,
    ENTRY_FEE: Shared.ENTRY_FEE,
    createArea: Area.createArea,
    processPlayer: Area.processPlayer,
    stepTrap: Area.stepTrap,
    trapSteps: Area.trapSteps,
    heading: Area.heading,
    rollTrap: Area.rollTrap,
    PAID_ATTRIBUTE: Shared.PAID_ATTRIBUTE,
    enterArena: Dispensers.enterArena,
    leaveArena: Dispensers.leaveArena,
    payIzzy: Dispensers.payIzzy,
    climbDown: Dispensers.climbDown,
    hasPaid: Dispensers.hasPaid,
    answerCondition: Dispensers.answerCondition,
    transcriptPayment: Dispensers.transcriptPayment,
    tagDispenser: Dispensers.tagDispenser,
    logout: Dispensers.logout,
    login: Dispensers.login,
    death: Dispensers.death,
    obstacleXp: Obstacles.obstacleXp,
    familyAt: Obstacles.familyAt,
    crossingTarget: Obstacles.crossingTarget,
    ropeSwingSteps: Obstacles.ropeSwingSteps,
    routeToObstacle: Obstacles.routeToObstacle,
    lineAt: Obstacles.lineAt,
    crossing: Obstacles.crossing,
    crossingSteps: Obstacles.crossingSteps,
    LINES: Obstacles.LINES,
  },
  register(api) {
    Shared.init(api);
    Area(api);
    Dispensers(api);
    Obstacles(api);
    Store(api);
  },
};

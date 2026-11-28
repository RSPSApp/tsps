"use strict";
// A character's last hit taken (HitQueue.lastAppliedHit) no longer names a player who left the world.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Combat } = require("../dist/game/content/combat/Combat");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");

let cycle = 1000;

function fake(kind, name, hitpoints = 99) {
  const mobile = {
    name, hitpoints, registered: true,
    isNpc: () => kind === "npc", isPlayer: () => kind === "player",
    isRegistered: () => mobile.registered,
    getHitpoints: () => mobile.hitpoints,
    isUntargetable: () => false,
    getAsPlayer: () => ({ getHitpoints: () => 0 }), // CombatFactory.handleRedemption stops at once
    decrementHealth: (hit) => { mobile.hitpoints = Math.max(0, mobile.hitpoints - hit.getDamage()); return hit; },
    addTickHit: () => {},
    getCombat: () => mobile.combat,
  };
  mobile.combat = new Combat(mobile);
  return mobile;
}

/** `dealer` hits `victim` for `damage` (0 is a miss) and the victim's queue lands it. */
function hit(victim, dealer, damage) {
  const queue = victim.combat.getHitQueue();
  queue.addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(dealer)]);
  queue.process(++cycle);
}

const dealerOf = (victim) => victim.combat.getHitQueue().getLastAppliedHit()?.getSource() ?? null;

function leave(player) {
  player.registered = false;
  player.combat.forgetFights();
}

test("an NPC's last hit stops naming a player who hit it and logged out", () => {
  const npc = fake("npc", "goblin");
  const player = fake("player", "leaver");
  hit(npc, player, 3);
  assert.equal(dealerOf(npc), player);

  leave(player);

  assert.equal(dealerOf(npc), null);
});

test("a miss (not in the damage map) is forgotten too", () => {
  const npc = fake("npc", "goblin");
  const player = fake("player", "leaver");
  hit(npc, player, 0);
  assert.equal(dealerOf(npc), player);

  leave(player);

  assert.equal(dealerOf(npc), null);
});

test("a player's last hit taken from another player is forgotten when that player leaves", () => {
  const stayer = fake("player", "stayer");
  const leaver = fake("player", "leaver");
  hit(stayer, leaver, 2);
  assert.equal(dealerOf(stayer), leaver);

  leave(leaver);

  assert.equal(dealerOf(stayer), null);
});

test("a hit from a player who is still here stays, whoever else leaves", () => {
  const npc = fake("npc", "cow");
  const stayer = fake("player", "stayer");
  const leaver = fake("player", "leaver");
  hit(npc, stayer, 2);
  hit(fake("npc", "rat"), leaver, 1);

  leave(leaver);

  assert.equal(dealerOf(npc), stayer);
});

test("a hit dealt by an NPC is left alone", () => {
  const player = fake("player", "victim");
  const npc = fake("npc", "dog");
  hit(player, npc, 1);

  npc.registered = false;
  npc.combat.forgetFights();

  assert.equal(dealerOf(player), npc);
});

"use strict";
// A player who leaves the world is no longer kept in memory by the fights that recorded it.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Combat } = require("../dist/game/content/combat/Combat");

function fakePlayer(name) {
  const player = {
    name, registered: true,
    isNpc: () => false, isPlayer: () => true,
    isRegistered: () => player.registered,
    getCombat: () => player.combat,
  };
  player.combat = new Combat(player);
  return player;
}

function fakeNpc() {
  const npc = { registered: true, isNpc: () => true, isPlayer: () => false, isRegistered: () => npc.registered,
    getCombat: () => npc.combat };
  npc.combat = new Combat(npc);
  return npc;
}

const damageMapOf = (combat) => combat.damageMap;

test("an NPC a player damaged forgets that player when the player leaves the world", () => {
  const npc = fakeNpc();
  const player = fakePlayer("leaver");
  const stayer = fakePlayer("stayer");
  npc.combat.addDamage(player, 5);
  npc.combat.addDamage(stayer, 3);
  npc.combat.addDamage(player, 2);
  assert.equal(damageMapOf(npc.combat).size, 2);

  player.registered = false;
  player.combat.forgetFights();

  assert.equal(damageMapOf(npc.combat).has(player), false);
  assert.equal(damageMapOf(npc.combat).has(stayer), true, "other fighters keep their damage");
  assert.equal(npc.combat.lastDamager, null, "the departed last damager is dropped");
  assert.equal(npc.combat.getLastDamager(), null);
});

test("an NPC whose last attack went at a player forgets that player when the player leaves", () => {
  const npc = fakeNpc();
  const player = fakePlayer("target");
  npc.combat.lastAttackTarget = player;
  player.combat.noteRecordedIn(npc.combat); // as the attack path does for a player target
  player.combat.forgetFights();
  assert.equal(npc.combat.lastAttackTarget, null);
});

test("a long session drops the fights of NPCs that are gone from the world", () => {
  const player = fakePlayer("grinder");
  const npcs = Array.from({ length: 200 }, () => fakeNpc());
  for (const npc of npcs) {
    npc.combat.addDamage(player, 1);
    npc.registered = false; // killed and despawned
  }
  assert.ok(player.combat.recordedIn.size <= 64, `recorded ${player.combat.recordedIn.size} fights`);
});

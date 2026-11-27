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

test("damage that lands after a player left (a burn tick) does not record that player again", () => {
  const npc = fakeNpc();
  const player = fakePlayer("burner");
  npc.combat.addDamage(player, 4);
  player.registered = false;
  player.combat.forgetFights();

  npc.combat.addDamage(player, 1);

  assert.equal(damageMapOf(npc.combat), null, "the departed player is not added back");
  assert.equal(npc.combat.lastDamager, null);
  assert.equal(player.combat.recordedIn, null, "the departed player's own fights stay forgotten");
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

test("a player who fought another player is not kept by that opponent after leaving", () => {
  const leaver = fakePlayer("leaver");
  const stayer = fakePlayer("stayer");
  stayer.combat.addDamage(leaver, 3); // the leaver hit the stayer
  leaver.combat.addDamage(stayer, 2); // the stayer hit back
  leaver.combat.lastAttackTarget = stayer;
  stayer.combat.noteRecordedIn(leaver.combat); // as the attack path does for a player target

  leaver.registered = false;
  leaver.combat.forgetFights();

  const held = [...(stayer.combat.recordedIn ?? [])].filter((combat) => combat.character === leaver);
  assert.equal(held.length, 0, "the stayer's recorded fights no longer hold the leaver");
  assert.equal(stayer.combat.damageMap, null, "the leaver's damage on the stayer is forgotten");
  assert.equal(stayer.combat.records?.has(leaver.combat) ?? false, false, "the stayer no longer lists the leaver");
});

test("a dead NPC another player still holds does not keep a player whose long session dropped it", () => {
  const grinder = fakePlayer("grinder");
  const helper = fakePlayer("helper");
  const boss = fakeNpc();
  boss.combat.addDamage(helper, 5);
  boss.combat.addDamage(grinder, 5);
  boss.combat.getKiller(true);
  boss.registered = false; // killed and despawned
  for (let i = 0; i < 70; i++) fakeNpc().combat.addDamage(grinder, 1); // the boss is dropped from the grinder's fights

  grinder.registered = false;
  grinder.combat.forgetFights();

  assert.ok(helper.combat.recordedIn.has(boss.combat), "the helper still lists the dead boss");
  assert.notEqual(boss.combat.lastDamager, grinder, "but the boss no longer points at the departed grinder");
});

test("an attack that still lands on a player after it left does not record it again", () => {
  const npc = fakeNpc();
  const player = fakePlayer("target");
  player.registered = false;
  player.combat.forgetFights();

  npc.combat.lastAttackTarget = player;
  player.combat.noteRecordedIn(npc.combat); // as the attack path does for a player target

  assert.equal(npc.combat.lastAttackTarget, null);
  assert.equal(player.combat.recordedIn, null);
  assert.equal(npc.combat.records?.has(player.combat) ?? false, false);
});

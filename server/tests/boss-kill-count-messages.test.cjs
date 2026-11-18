// node --test tests/boss-kill-count-messages.test.cjs
// Bosses counted only by Combat Achievements still tell "Your <boss> kill count is: N." on a kill.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Plugin = require("../plugins/bosses/KillCountMessages.plugin");
const BOSSES = require("../plugins/achievements/combatachievements/data/bosses.json");
const MONSTERS = require("../plugins/achievements/combatachievements/data/monsters.json");

function harness(counts) {
  const deaths = [];
  const asked = [];
  Plugin.register({
    onNpcDeath: (fn) => deaths.push(fn),
    emitCustomEvent(name, request) {
      if (name !== "combat-achievements:count") return;
      asked.push(request.monster);
      if (request.monster in counts) request.total = counts[request.monster];
    },
  });
  return { die: (event) => deaths.forEach((fn) => fn(event)), asked };
}

function player() {
  const messages = [];
  return {
    messages,
    isPlayer: () => true,
    sendMessage: (text) => messages.push(text),
    getPacketSender: () => ({ getVarbit: () => 0 }),
  };
}

const npc = (name) => ({ getCurrentDefinition: () => ({ getName: () => name }) });

test("a listed boss's kill tells Combat Achievements' count", () => {
  const h = harness({ Vorkath: 7, "DK: Rex": 2 });
  const p = player();
  h.die({ npc: npc("Vorkath"), killer: p });
  h.die({ npc: npc("Dagannoth Rex"), killer: p });
  assert.deepEqual(p.messages, [
    "Your Vorkath kill count is: <col=ff0000>7</col>.",
    "Your Dagannoth Rex kill count is: <col=ff0000>2</col>.",
  ]);
});

test("other NPCs, NPC killers and an unanswered count say nothing", () => {
  const h = harness({});
  const p = player();
  h.die({ npc: npc("Goblin"), killer: p });
  h.die({ npc: npc("Vorkath"), killer: { isPlayer: () => false } });
  h.die({ npc: npc("Kraken"), killer: p });
  assert.deepEqual(p.messages, []);
  assert.deepEqual(h.asked, ["Kraken"]);
});

test("every listed monster is a boss-log entry Combat Achievements counts by NPC death", () => {
  const byEvent = new Set(MONSTERS.countedByEvent);
  const bosses = new Map(BOSSES.map((boss) => [boss.name.toLowerCase(), boss]));
  for (const monster of Object.values(Plugin.MONSTERS)) {
    const boss = bosses.get(monster.toLowerCase());
    assert.ok(boss, `${monster} is a Combat Achievements boss`);
    assert.equal(boss.killVarps.length, 1, `${monster} has a boss-log count`);
    assert.ok(!byEvent.has(boss.name), `${monster} is counted by NPC death, not by its plugin`);
  }
});

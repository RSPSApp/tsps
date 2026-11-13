// Run after `yarn build`, from server/: node --test tests/npc-combat-sounds.test.cjs
//
// NPCs make sounds in a fight that live sends as private synths to the player in it: a hit sound when the
// NPC is hit, an attack sound when it starts an attack, a death sound when it dies (rsprox captures,
// data/definitions/npc-combat-sounds.json from scripts/mine-npc-combat-sounds.mjs). The old NPC attack and
// death sounds went out as radius-0 area sounds, which the client drops, so nothing was heard.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { NpcCombatSounds } = require('../dist/game/definition/NpcCombatSounds');

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/definitions/npc-combat-sounds.json'), 'utf8')).npcs;

function player() {
  const sent = [];
  return {
    sent,
    isRegistered: () => true,
    isUnwatchedBot: () => false,
    getUsername: () => 'p',
    getPacketSender: () => ({ sendSoundEffect: (id, loops, delay) => sent.push([id, loops, delay]) }),
  };
}
const npc = (id, deathSound = -1) => ({ getCurrentDefinition: () => ({ getId: () => id, getDeathSound: () => deathSound }) });
const withKind = (kind) => Object.entries(data).find(([, v]) => v[kind]?.length)[0];

test('the data is well formed: [sound, delay] pairs of positive ids', () => {
  assert.ok(Object.keys(data).length > 100);
  for (const [id, kinds] of Object.entries(data)) {
    assert.ok(Number.isInteger(Number(id)));
    for (const [kind, list] of Object.entries(kinds)) {
      assert.ok(['hit', 'attack', 'death'].includes(kind), `${id} ${kind}`);
      for (const [sound, delay] of list) assert.ok(Number.isInteger(sound) && sound > 0 && Number.isInteger(delay) && delay >= 0);
    }
  }
});

test('a hit NPC plays its hit sound to the attacker as a private synth', () => {
  const id = withKind('hit');
  const p = player();
  NpcCombatSounds.hit(npc(Number(id)), p);
  assert.equal(p.sent.length, 1);
  assert.ok(data[id].hit.some(([sound, delay]) => sound === p.sent[0][0] && delay === p.sent[0][2]));
});

test('an attacking NPC plays its attack sound to its target', () => {
  const id = withKind('attack');
  const p = player();
  NpcCombatSounds.attack(npc(Number(id)), p);
  assert.equal(p.sent.length, 1);
  assert.ok(data[id].attack.some(([sound]) => sound === p.sent[0][0]));
});

test('a dying NPC plays its death sound to everyone who fought it; the definition\'s own wins', () => {
  const id = withKind('death');
  const a = player();
  const b = player();
  NpcCombatSounds.death(npc(Number(id)), [a, b]);
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
  assert.ok(data[id].death.some(([sound]) => sound === a.sent[0][0]));
  const c = player();
  NpcCombatSounds.death(npc(Number(id), 512), [c]);
  assert.deepEqual(c.sent, [[512, 0, 0]]);
});

test('an NPC with no captured sounds, and a logged-out listener, stay silent', () => {
  const p = player();
  NpcCombatSounds.hit(npc(999999), p);
  NpcCombatSounds.attack(npc(999999), p);
  NpcCombatSounds.death(npc(999999), [p]);
  const gone = player();
  gone.isRegistered = () => false;
  NpcCombatSounds.hit(npc(Number(withKind('hit'))), gone);
  assert.deepEqual(p.sent, []);
  assert.deepEqual(gone.sent, []);
});

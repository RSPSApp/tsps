// Run after `yarn build`: node --test tests/varrock-bank-locked-door.test.cjs
//
// Varrock West Bank's locked back door (fai_varrock_bank_locked_door, 3186,3446) against
// rsprox.net rec 3213 (rev 232, ticks 4464-5070, five knocks): Knock-at gives the player's
// "I don't think I'm ever going to be allowed in there." (chatbored1 562); Continue opens
// "Knock knock..." (sound 1735, no Continue) for two ticks, then the Banker's "Who's there?";
// Continue offers five answers, each played to the Banker's send-off.
// On a real Player with its real DialogueManager, PacketSender and TaskManager.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Misthalin, core;
const hooks = {};

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Misthalin = require('../plugins/areas/Misthalin.plugin');
  Misthalin.register({
    core,
    persistAttribute: () => {},
    onObjectRoute: () => {},
    onObjectInteraction: (name, actions) => { hooks[name] = { ...(hooks[name] ?? {}), ...actions }; },
    onItemOnObject: () => {},
    onPlayerLogin: () => {},
    emitCustomEvent: () => {},
  });
});

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(79);
  p.texts = [];
  p.anims = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p, 'getDisplayName', () => 'Blurite Rock');
  p.sounds = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendString', (text, id) => { p.texts.push(text); return sender; });
  t.mock.method(sender, 'sendInterfaceAnimation', (id, anim) => { p.anims.push(anim); return sender; });
  t.mock.method(sender, 'sendSound', (id) => { p.sounds.push(id); return sender; });
  return p;
}

const PLAYER_CONTINUE = (217 << 16) | 5;
const NPC_CONTINUE = (231 << 16) | 5;
const MESBOX_CONTINUE = (229 << 16) | 4;
const OPTIONS = (219 << 16) | 1;
const resume = (p, widget, child = -1) => p.getDialogueManager().handleResume(widget, child);
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

/** Knock, Continue, wait out "Knock knock...", Continue: the five answers are showing. */
function toAnswers(t, p) {
  assert.equal(knock(p, 11788), true);
  p.texts.length = 0;
  assert.equal(resume(p, PLAYER_CONTINUE), true);
  assert.ok(p.texts.includes('<col=000080>Knock knock...'), JSON.stringify(p.texts));
  assert.ok(p.texts.includes(''), 'the knock box has no Continue');
  assert.deepEqual(p.sounds, [1735]);
  // Held: a Continue on the knock box does not skip it, and the Banker waits two ticks.
  resume(p, MESBOX_CONTINUE);
  ticks(1);
  assert.ok(!p.texts.includes("Who's there?"));
  ticks(1);
  assert.ok(p.texts.includes("Who's there?"), JSON.stringify(p.texts));
  assert.ok(p.anims.includes(614));
  assert.equal(resume(p, NPC_CONTINUE), true);
  assert.deepEqual(p.getDialogueManager().getCurrent().getOptions(),
    ["I'm Blurite Rock. Please let me in.", 'Boo.', 'Kanga.', 'Thank.', 'Doctor.']);
  assert.equal(p.getDialogueManager().getCurrent().getTitle(), 'What would you like to say?');
}

/** Picks `option`, then Continues through the pages; returns each page's text and head anim. */
function playAnswer(p, option) {
  const pages = [];
  p.texts.length = 0;
  p.anims.length = 0;
  assert.equal(resume(p, OPTIONS, option), true);
  while (p.getDialogueManager().isActive()) {
    const current = p.getDialogueManager().getCurrent();
    pages.push([current.getText(), p.anims.at(-1)]);
    p.anims.length = 0;
    const player = current.constructor.name === 'PlayerDialogue';
    assert.equal(resume(p, player ? PLAYER_CONTINUE : NPC_CONTINUE), true);
  }
  return pages;
}

const C = () => core.CacheDefinitions;
const knock = (p, objectId) => hooks.Door['Knock-at']({ player: p, objectId, option: 'knock-at', location: { x: 3186, y: 3446, z: 0 } });

test('the cache door is "Door" with a single Knock-at', () => {
  const id = C().getLocId('fai_varrock_bank_locked_door');
  assert.equal(id, 11788);
  const def = C().getObject(id);
  assert.equal(def.name, 'Door');
  assert.equal(def.actions[0], 'Knock-at');
});

test('Knock-at gives the recorded player line with chatbored1, every knock', (t) => {
  const p = realPlayer(t);
  for (let i = 0; i < 2; i++) {
    p.texts.length = 0;
    p.anims.length = 0;
    assert.equal(knock(p, 11788), true);
    assert.ok(p.texts.includes("I don't think I'm ever going to be allowed in there."), JSON.stringify(p.texts));
    assert.ok(p.anims.includes(562), JSON.stringify(p.anims));
    p.getDialogueManager().reset?.();
  }
});

const RECORDED = {
  1: [["I'm Blurite Rock. Please let me in.", 567], ["No. Staff only beyond this point. You can't come in here.", 615]],
  2: [['Boo.', 592], ['Boo who?', 554], ["There's no need to cry!", 605], ["What? I'm not... oh, just go away!", 575]],
  3: [['Kanga.', 592], ['Kanga who?', 554], ["No, 'kangaroo'.", 605], ['Stop messing about and go away!', 614]],
  4: [['Thank.', 592], ['Thank who?', 554], ["You're welcome!", 605], ['Stop it!', 614]],
  5: [['Doctor.', 592], ["Doctor wh.. hang on, I'm not falling for that one again! Go away.", 615]],
};

for (const option of [1, 2, 3, 4, 5]) {
  test(`Continue knocks, and answer ${option} plays the recorded exchange to its close`, (t) => {
    const p = realPlayer(t);
    toAnswers(t, p);
    assert.deepEqual(playAnswer(p, option), RECORDED[option]);
    assert.equal(p.getDialogueManager().isActive(), false);
  });
}

test('walking off during "Knock knock..." leaves no Banker line behind', (t) => {
  const p = realPlayer(t);
  knock(p, 11788);
  resume(p, PLAYER_CONTINUE);
  p.getDialogueManager().reset();
  p.texts.length = 0;
  ticks(3);
  assert.ok(!p.texts.includes("Who's there?"));
});

test('other locs are left to their own handlers', (t) => {
  const p = realPlayer(t);
  assert.equal(knock(p, C().getLocId('fai_varrock_ladder')), false);
  assert.deepEqual(p.texts, []);
});

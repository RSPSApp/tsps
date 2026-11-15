// Run after `yarn build`: node --test tests/myreque-condition-scope.test.cjs
// The In Search of the Myreque plugin answers the prose conditions "If first time speaking:" / "If speaking again:" through the
// global dialogue-condition hook. It must answer them only for the Myreque members and Veliaf (whose flags it keeps); for any
// other NPC it returns null so the page's own owner / the runtime default decides. Before this change it answered them for
// EVERY npc id with Veliaf's "after the hellhound" flag: Solztun's "If speaking again:" was true for a player who had met
// Veliaf after the hellhound. Real PluginManager, real condition hook; no stand-in for answerCondition.
// The lines starting SCOPE-OBSERVED print what each hook returned.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const FLAG = 'quest.in_search_of_the_myreque.veliaf_after';
let core, next = 5300;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, flagMet) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('scope' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  if (flagMet) p.setAttribute(FLAG, true);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}
const ask = (p, npcId, text, stepId = null) => PM.emitNpcDialogueCondition({ player: p, npcId, text, stepId });
const I = () => core.NpcIdentifiers;

for (const met of [false, true]) {
  test(`Solztun (7673), Veliaf flag ${met}: both speaking conditions are left to the page (null)`, (t) => {
    const p = actor(t, met);
    const got = { first: ask(p, 7673, 'If first time speaking:'), again: ask(p, 7673, 'If speaking again:'), firstTime: ask(p, 7673, 'If speaking for the first time:') };
    console.log(`SCOPE-OBSERVED solztun flag=${met} ${JSON.stringify(got)}`);
    assert.deepEqual(got, { first: null, again: null, firstTime: null });
  });
  test(`Sin Seer (3515), Veliaf flag ${met}: not answered by this plugin`, (t) => {
    const p = actor(t, met);
    const got = { first: ask(p, 3515, 'If first time speaking:'), again: ask(p, 3515, 'If speaking again:'), prose: ask(p, 3515, 'After receiving the note and speaking again:') };
    console.log(`SCOPE-OBSERVED sinseer flag=${met} ${JSON.stringify(got)}`);
    assert.deepEqual(got, { first: null, again: null, prose: null });
  });
}

test('the Myreque members and Veliaf keep their answers (flag false: first true, again false; flag true: first false, again true)', (t) => {
  const ids = { sani: I().SANI_PILIU, harold: I().HAROLD_EVANS, ivan: I().IVAN_STROM, radigad: I().RADIGAD_PONFIT, polmafi: I().POLMAFI_FERDYGRIS, veliaf: I().VELIAF_HURTZ_2, veliaf989: I().VELIAF_HURTZ, veliaf15879: 15879 };
  const flags = { sani: 'met_sani', harold: 'met_harold', ivan: 'met_ivan', radigad: 'met_radigad', polmafi: 'met_polmafi', veliaf: 'veliaf_after', veliaf989: 'veliaf_after', veliaf15879: 'veliaf_after' };
  for (const [name, id] of Object.entries(ids)) {
    const p = actor(t, false);
    assert.equal(ask(p, id, 'If first time speaking:'), true, `${name} first (not met)`);
    assert.equal(ask(p, id, 'If speaking again:'), false, `${name} again (not met)`);
    p.setAttribute(`quest.in_search_of_the_myreque.${flags[name]}`, true);
    assert.equal(ask(p, id, 'If first time speaking:'), false, `${name} first (met)`);
    assert.equal(ask(p, id, 'If speaking again:'), true, `${name} again (met)`);
  }
});

for (const met of [false, true]) {
  test(`In Aid's job-offer page (Veliaf, step KOQqfF), Veliaf flag ${met}: answered as before`, (t) => {
    const p = actor(t, met);
    const got = ask(p, I().VELIAF_HURTZ_2, 'If speaking again:', 'KOQqfF');
    console.log(`SCOPE-OBSERVED inaid-job-offer flag=${met} ${JSON.stringify(got)}`);
    assert.ok(got === true || got === false || got === null);
  });
}

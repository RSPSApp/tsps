const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core, quests, started = false, serial = 0;
const actors = [], npcs = [], starts = new WeakMap(), stages = new WeakMap();
const oldBots = process.env.DISABLE_PLAYER_BOTS;
const required = ['the_fremennik_isles', 'lunar_diplomacy', 'mountain_daughter', 'heroes_quest'];
function attempt(errors, fn) { try { fn(); } catch (error) { errors.push(error); } }
after(() => {
  const errors = [];
  try {
    if (core) {
      for (const p of actors) {
        attempt(errors, () => { if (p.isRegistered()) PluginManager.emitPlayerLogout({player:p, username:p.getUsername()}); });
        attempt(errors, () => core.TaskManager.cancelTasks(p));
        attempt(errors, () => core.TaskManager.cancelTasks(p.getIndex()));
        attempt(errors, () => { if (p.isRegistered()) core.World.getPlayers().remove(p); });
      }
      for (const npc of npcs) attempt(errors, () => { if (npc.isRegistered()) PluginManager.removeNpc(npc); });
    }
  } finally {
    try { attempt(errors, () => { if (started) PluginManager.emitServerShutdown({}); }); }
    finally {
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
  }
  if (errors.length) throw new AggregateError(errors, 'native fixture cleanup failed');
});
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2659, 3669);
  new NpcDefinitionLoader().load();
  started = true;
  PluginManager.emitServerStartup({});
  quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  PluginManager.createApi('ExilesStartObserver').onCustomEvent('npc-dialogue:start', e => {
    if (starts.has(e.player)) starts.get(e.player).push(e.variant);
  });
  PluginManager.createApi('ExilesStageObserver').onCustomEvent('quest:stage-changed', e => {
    if (e.key === 'the_fremennik_exiles' && stages.has(e.player)) stages.get(e.player).push(e.stage);
  });
});
test('registered Brundt start respects actual quest prerequisites and non-Mining skills', async t => {
  const handle = key => {
    const q = quests.filter(entry => entry.key === key).at(-1);
    assert.ok(q, `registered quest ${key}`); return q;
  };
  const exiles = handle('the_fremennik_exiles');
  const values = () => [[core.Skill.CRAFTING,65], [core.Skill.SLAYER,60],
    [core.Skill.SMITHING,60], [core.Skill.FISHING,60], [core.Skill.RUNECRAFTING,55], [core.Skill.MINING,59]];
  function actor(child, { missingQuest, lowSkill, seal = true, mining = 60 } = {}) {
    const channel = { kind:'test', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
    const session = new PlayerSession(channel), p = new Player(session, new core.Location(2659,3669,0));
    session.setPlayer(p); p.setUsername(`exiles${++serial}`);
    p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
    assert.notEqual(p.getLongUsername(), 0n);
    child.mock.method(p, 'onAdd', () => {}); child.mock.method(p, 'onRemove', () => {});
    const ownedNpcs = [];
    child.after(() => {
      const errors = [];
      attempt(errors, () => p.getPacketSender().sendInterfaceRemoval());
      attempt(errors, () => p.getDialogueManager().reset());
      attempt(errors, () => { if (p.isRegistered()) PluginManager.emitPlayerLogout({player:p, username:p.getUsername()}); });
      attempt(errors, () => core.TaskManager.cancelTasks(p));
      attempt(errors, () => core.TaskManager.cancelTasks(p.getIndex()));
      for (const npc of ownedNpcs) attempt(errors, () => { if (npc.isRegistered()) PluginManager.removeNpc(npc); });
      attempt(errors, () => { if (p.isRegistered()) core.World.getPlayers().remove(p); });
      attempt(errors, () => assert.equal(p.isRegistered(), false));
      attempt(errors, () => assert.equal(p.getDialogueManager().isActive(), false));
      attempt(errors, () => assert.equal(core.MultiChatboxPrompt.getPending(p), null));
      for (const npc of ownedNpcs) attempt(errors, () => assert.equal(npc.isRegistered(), false));
      if (errors.length) throw new AggregateError(errors, 'owned actor cleanup failed');
    });
    actors.push(p); starts.set(p, []); stages.set(p, []);
    assert.equal(core.World.getPlayers().add(p), true);
    assert.equal(core.World.getPlayers().get(p.getIndex()), p);
    p.setAttribute('bot-skip-persistence', true);
    for (const [skill, base] of values()) {
      const selected = skill === core.Skill.MINING ? mining : base;
      const level = skill === lowSkill ? selected - 1 : selected;
      p.getSkillManager().setMaxLevels(skill, level, false);
      p.getSkillManager().setExperience(skill, core.SkillManager.getExperienceForLevel(level));
      p.getSkillManager().setCurrentLevel(skill, level, false);
      assert.equal(p.getSkillManager().getMaxLevel(skill), level);
      assert.equal(p.getSkillManager().getCurrentLevel(skill), level);
    }
    for (const key of required) {
      const q = handle(key);
      p.setAttribute(`quest.${key}.stage`, key === missingQuest ? 0 : q.completionValue);
      const request = { player:p, key, complete:undefined };
      PluginManager.createApi('ExilesStartPrerequisiteCheck').emitCustomEvent('quest:is-complete', request);
      assert.equal(request.complete, key !== missingQuest, `real prerequisite response: ${key}`);
    }
    if (seal) p.getInventory().add(new core.Item(core.ItemIdentifiers.SEAL_OF_PASSAGE), false);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.SEAL_OF_PASSAGE), seal ? 1 : 0);
    const messages = [], sendMessage = p.sendMessage.bind(p);
    child.mock.method(p, 'sendMessage', message => { messages.push(message); return sendMessage(message); });
    const conn = new ClientConnection(channel); conn.player = p;
    assert.equal(exiles.getStage(p), 0);
    return { p, conn, ownedNpcs, messages };
  }
  function talk(f) {
    const definition = core.NpcDefinition.forId(9263);
    assert.equal(definition.getName(), 'Brundt the Chieftain');
    assert.ok(definition.getActions().includes('Talk-to'));
    const npc = core.NPC.create(9263, new core.Location(2659,3670,0));
    assert.equal(core.World.getNpcs().add(npc), true); npcs.push(npc); f.ownedNpcs.push(npc);
    const current = npc.getCurrentDefinition(f.p);
    assert.equal(npc.getContentId(f.p), 9263);
    assert.equal(current.getName(), 'Brundt the Chieftain');
    assert.ok(current.getActions().includes('Talk-to'));
    const event = {player:f.p, npc, npcId:npc.getContentId(f.p), definition:current, clickType:1, handled:false};
    PluginManager.emitNpcInteraction(event);
    return event;
  }
  function choose(f, text) {
    const manager = f.p.getDialogueManager();
    for (let i=0; i<80 && !core.MultiChatboxPrompt.getPending(f.p) && manager.isActive(); i++) {
      const current = manager.getCurrent();
      if (current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process();
      else manager.advance();
    }
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    assert.ok(pending, `generated prompt for ${text}`);
    const index = pending.options.indexOf(text);
    assert.ok(index >= 0, `${text} in ${JSON.stringify(pending.options)}`);
    assert.equal(PluginManager.emitInterfaceActionClick({player:f.p, groupId:219, childId:1,
      buttonId:(219<<16)|1, slot:index+1, action:1, handled:false}), true);
  }
  await t.test('Mining 59 reaches the actual Yes and starts', child => {
    const f = actor(child, {mining:59});
    assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.MINING), 59);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.MINING), 59);
    assert.equal(talk(f).handled, true);
    assert.ok(starts.get(f.p).includes('starting-out-brundt-the-chieftain'));
    choose(f, 'Ask for a quest.'); choose(f, 'Yes.');
    assert.ok(stages.get(f.p).includes(5), 'the actual choice commits the started stage');
    assert.equal(exiles.getStage(f.p), 10, 'generated dialogue eagerly processes its later Freygerd line');
  });
  for (const [label, skill] of [['Crafting',core.Skill.CRAFTING], ['Slayer',core.Skill.SLAYER],
    ['Smithing',core.Skill.SMITHING], ['Fishing',core.Skill.FISHING], ['Runecrafting',core.Skill.RUNECRAFTING]]) {
    await t.test(`${label} remains required`, child => {
      const f = actor(child, {lowSkill:skill}); talk(f);
      assert.ok(!starts.get(f.p).includes('starting-out-brundt-the-chieftain'));
      assert.equal(exiles.getStage(f.p), 0);
    });
  }
  for (const key of required) await t.test(`${key} remains required`, child => {
    const f = actor(child, {missingQuest:key}); talk(f);
    assert.ok(!starts.get(f.p).includes('starting-out-brundt-the-chieftain'));
    assert.equal(exiles.getStage(f.p), 0);
  });
  await t.test('No keeps stage zero', child => {
    const f = actor(child); talk(f); choose(f, 'Ask for a quest.'); choose(f, 'No.');
    assert.equal(exiles.getStage(f.p), 0);
  });
  await t.test('Yes rechecks the other skill requirements', child => {
    const f = actor(child); talk(f); choose(f, 'Ask for a quest.');
    f.p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 64, false);
    const xp64 = core.SkillManager.getExperienceForLevel(64);
    f.p.getSkillManager().setExperience(core.Skill.CRAFTING, xp64);
    f.p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 64, false);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.CRAFTING), xp64);
    assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.CRAFTING), 64);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.CRAFTING), 64);
    choose(f, 'Yes.');
    child.diagnostic(JSON.stringify({stage:exiles.getStage(f.p), stages:stages.get(f.p), messages:f.messages}));
    assert.ok(f.messages.includes("You don't meet the requirements for this quest."));
    assert.deepEqual(stages.get(f.p), []);
    assert.equal(exiles.getStage(f.p), 0);
  });
  await t.test('missing seal yields to Lunar reclaim', child => {
    const f = actor(child, {seal:false}); assert.equal(talk(f).handled, true);
    assert.ok(!starts.get(f.p).includes('starting-out-brundt-the-chieftain'));
    choose(f, 'Ask about a Seal of Passage.');
    const manager = f.p.getDialogueManager();
    for (let i=0; i<80 && f.p.getInventory().getAmount(core.ItemIdentifiers.SEAL_OF_PASSAGE) === 0; i++) {
      assert.ok(manager.isActive(), 'replacement dialogue remains active until seal granted');
      const current = manager.getCurrent();
      if (current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process();
      else manager.advance();
    }
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.SEAL_OF_PASSAGE), 1);
    assert.equal(exiles.getStage(f.p), 0);
  });
});

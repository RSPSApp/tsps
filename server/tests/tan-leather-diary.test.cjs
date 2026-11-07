// Unexecuted draft; copy into server/tests only after source/fixture review.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, quest, diary, Progress;
const errors=[]; const originalError=console.error;
// Flagged registered only: actors are not inserted into World or logged in.
const { GameConstants } = require('../dist/game/GameConstants');
before(async () => {
  console.error=(...args)=>{ errors.push(args.map(String).join(' ')); originalError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.getCoreApi().ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'lunar_diplomacy');
  diary = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('fremennik');
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  assert.ok(quest); assert.ok(diary); assert.equal(diary.tiers.hard.tasks.length,9);
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => { try { PM.emitServerShutdown({}); assert.deepEqual(errors,[],'plugin/bootstrap errors'); } finally { console.error=originalError; } });
function actor(t, index, complete, claimed) {
  const channel = {kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onError(){}, onClose(){}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index); p.setUsername('tan'+index); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername())); p.setRegistered(true); assert.notEqual(p.getLongUsername(),0n); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(3226,3218,0)); p.needsPlacement=false;
  t.after(()=>{ PM.emitPlayerDisconnect({player:p,username:p.getUsername()}); PM.emitPlayerLogout({player:p,username:p.getUsername()}); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p); });
  for (const [skill, level] of [[core.Skill.MAGIC,78],[core.Skill.DEFENCE,40]]) {
    p.getSkillManager().setMaxLevels(skill,level,false).setExperience(skill,core.SkillManager.getExperienceForLevel(level)).setCurrentLevel(skill,level,false);
  }
  quest.setStage(p,190); p.setSpellbook(core.MagicSpellbook.LUNAR);
  const all = ['easy','medium','hard'].flatMap(tier => diary.tiers[tier].tasks.map(task=>task.key));
  p.setAttribute(Progress.TASKS_ATTRIBUTE, complete ? {fremennik:all} : {});
  p.setAttribute(Progress.REWARDS_ATTRIBUTE, claimed ? {fremennik:['easy','medium','hard']} : {});
  assert.equal(core.MagicSpellbook.LUNAR.getInterfaceId(),29999);
  p.getPacketSender().sendTabInterface(6, core.MagicSpellbook.LUNAR.getInterfaceId());
  assert.equal(p.getPacketSender().getVarbit(4533),1, 'first mount bootstrap');
  assert.equal(p.getSpellbook(),core.MagicSpellbook.LUNAR);
  for(const [skill, level] of [[core.Skill.MAGIC,78],[core.Skill.DEFENCE,40]]) {
    assert.equal(p.getSkillManager().getCurrentLevel(skill),level); assert.equal(p.getSkillManager().getMaxLevel(skill),level);
    assert.equal(p.getSkillManager().getExperience(skill),core.SkillManager.getExperienceForLevel(level));
  }
  assert.equal(p.getAttribute('quest.lunar_diplomacy.stage'),190);
  assert.equal(p.getEquipment().getItems().some(i=>i&&i.getId()>0),false);
  const q={player:p,key:'lunar_diplomacy',complete:null}; PM.emitCustomEvent('quest:is-complete',q); assert.equal(q.complete,true);
  const d={player:p,diary:'fremennik',tier:'hard',complete:null}; PM.emitCustomEvent('diary:is-complete',d); assert.equal(d.complete,complete);
  const r={player:p,diary:'fremennik',tier:'hard',claimed:null}; PM.emitCustomEvent('diary:is-reward-claimed',r); assert.equal(r.claimed,claimed);
  const inv=p.getInventory(), ids=core.ItemIdentifiers;
  for(const [id,n] of [[ids.COWHIDE,1],[ids.ASTRAL_RUNE,2],[ids.NATURE_RUNE,1],[ids.FIRE_RUNE,5]]) inv.add(new core.Item(id,n),false);
  for(const [id,n] of [[ids.COWHIDE,1],[ids.ASTRAL_RUNE,2],[ids.NATURE_RUNE,1],[ids.FIRE_RUNE,5]]) assert.equal(inv.getAmount(id),n);
  assert.equal(inv.getAmount(ids.LEATHER),0);
  for(const [id,name] of [[ids.COWHIDE,'Cowhide'],[ids.LEATHER,'Leather'],[ids.ASTRAL_RUNE,'Astral rune'],[ids.NATURE_RUNE,'Nature rune'],[ids.FIRE_RUNE,'Fire rune']]) {
    const definition=core.ItemDefinition.forId(id); assert.equal(definition.getName().toLowerCase(),name.toLowerCase()); assert.equal(definition.isNoted(),false);
  }
  const gate=PM.emitCanGainExperience(p,core.Skill.MAGIC,81); assert.notEqual(gate.allow,false); assert.equal(gate.multiplier,1); assert.equal(GameConstants.EXPERIENCE_MULTIPLIER,1);
  const c=new ClientConnection(channel); c.player=p;
  return {p,c,inv,ids};
}
async function cast(c) {
  const spell=core.CacheDefinitions.getSpellByName('Tan Leather'); assert.ok(spell);
  assert.equal(core.CacheDefinitions.isSpellWidgetGroup(spell.widgetId>>>16),true);
  assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId,spell.itemId),'Tan Leather');
  await c.dispatch([{type:'widget_action',widgetId:spell.widgetId,groupId:spell.widgetId>>>16,childId:spell.widgetId&65535,slot:-1,buttonNum:1,itemId:spell.itemId}]);
  c.processTurnPackets();
}
test('Tan Leather requires the Fremennik hard diary', async t => {
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  for(const [index,complete,claimed,allowed] of [[1702,true,true,true],[1701,false,false,false]]) await t.test(allowed?'complete and claimed':'incomplete and unclaimed',async t=>{
    const {p,c,inv,ids}=actor(t,index,complete,claimed); const xp=p.getSkillManager().getExperience(core.Skill.MAGIC), craft=p.getSkillManager().getExperience(core.Skill.CRAFTING);
    await cast(c);
    assert.equal(inv.getAmount(ids.COWHIDE),allowed?0:1);
    assert.equal(inv.getAmount(ids.LEATHER),allowed?1:0);
    for(const [id,n] of [[ids.ASTRAL_RUNE,2],[ids.NATURE_RUNE,1],[ids.FIRE_RUNE,5]]) assert.equal(inv.getAmount(id),allowed?0:n);
    assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC)-xp,allowed?81:0);
    assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING),craft);
  });
  await t.test('complete unclaimed observation',async t=>{
    const {p,c,inv,ids}=actor(t,1703,true,false); const xp=p.getSkillManager().getExperience(core.Skill.MAGIC), craft=p.getSkillManager().getExperience(core.Skill.CRAFTING);
    await cast(c);
    console.log('TAN_DIARY_INTERMEDIATE '+JSON.stringify({cowhide:inv.getAmount(ids.COWHIDE),leather:inv.getAmount(ids.LEATHER),astral:inv.getAmount(ids.ASTRAL_RUNE),nature:inv.getAmount(ids.NATURE_RUNE),fire:inv.getAmount(ids.FIRE_RUNE),magicXp:p.getSkillManager().getExperience(core.Skill.MAGIC)-xp}));
  });
});


test('completed diary cannot cast without required runes', async t=>{
  const {p,c,inv,ids}=actor(t,1704,true,true); inv.deleteNumber(ids.ASTRAL_RUNE,2);
  const magic=p.getSkillManager().getExperience(core.Skill.MAGIC), craft=p.getSkillManager().getExperience(core.Skill.CRAFTING);
  await cast(c); assert.equal(inv.getAmount(ids.COWHIDE),1); assert.equal(inv.getAmount(ids.LEATHER),0);
  assert.equal(inv.getAmount(ids.ASTRAL_RUNE),0); assert.equal(inv.getAmount(ids.NATURE_RUNE),1); assert.equal(inv.getAmount(ids.FIRE_RUNE),5);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC),magic); assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING),craft);
});

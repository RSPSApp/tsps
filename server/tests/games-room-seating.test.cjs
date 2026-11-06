const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const Seating=require('../plugins/minigames/gamesroom/Seating.GamesRoom');
let core;
test.before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  core=PluginManager.getCoreApi();Seating.configure(core);
});
function match(){
  const players=[new Player(null),new Player(null)];
  players.forEach((p,i)=>p.setLocation(new core.Location(2195+i*2,4947+i*2,0)));
  return {players,state:{turn:0}};
}
function seq(name){return core.CacheDefinitions.getSeqId(`human_sittingdown_${name}`);}

test('seating uses active cache chair animation, preserves custom movement and faces opponent',()=>{
  const m=match(),p=m.players[0],prior=[808,823,819,820,821,822,824];
  p.setRenderAnimations(prior);
  const weapon=new core.Item(core.ItemIdentifiers.BRONZE_SWORD,1);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT,weapon);
  Seating.seat(m);
  const seated=p.getRenderAnimations();
  assert.notEqual(seated,prior);
  assert.deepEqual(seated,[seq('ready'),seq('ready'),...prior.slice(2)]);
  assert.equal(p.getAnimation().getId(),seq('ready'));
  assert.ok(p.getPositionToFace().equals(m.players[1].getLocation()));
  assert.ok(p.getUpdateFlag().flagged(core.Flag.APPEARANCE));
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT],weapon);
  Seating.release(m);
  assert.equal(p.getRenderAnimations(),prior);
  assert.equal(p.getAnimation().getId(),core.Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT],weapon);
});
test('default stance restores to null and repeated seat/release keeps original snapshot',()=>{
  const m=match();
  Seating.seat(m);Seating.seat(m);
  Seating.release(m);Seating.release(m);
  for(const p of m.players)assert.equal(p.getRenderAnimations(),null);
  Seating.seat(m);Seating.release(m);
  for(const p of m.players)assert.equal(p.getRenderAnimations(),null);
});
test('historical five-tick minimum thinking affects only the current turn owner',t=>{
  t.mock.method(Math,'random',()=>0);
  const m=match(),start=core.World.getProcessCycle();Seating.seat(m);
  Seating.process(m,m.players[0],start+4);
  assert.equal(m.players[0].getAnimation().getId(),seq('ready'));
  Seating.process(m,m.players[1],start+5);
  assert.equal(m.players[1].getAnimation().getId(),seq('ready'));
  Seating.process(m,m.players[0],start+5);
  assert.equal(m.players[0].getAnimation().getId(),seq('think'));
  Seating.moved(m,m.players[0]);
  assert.equal(m.players[0].getAnimation().getId(),seq('move'));
  m.state.turn=1;
  Seating.process(m,m.players[0],start+6);
  assert.equal(m.players[0].getAnimation().getId(),seq('ready'));
  Seating.release(m);
});
test('historical nine-tick maximum permits scratch variation',t=>{
  t.mock.method(Math,'random',()=>0.999);
  const m=match(),start=core.World.getProcessCycle();Seating.seat(m);
  Seating.process(m,m.players[0],start+8);
  assert.equal(m.players[0].getAnimation().getId(),seq('ready'));
  Seating.process(m,m.players[0],start+9);
  assert.equal(m.players[0].getAnimation().getId(),seq('scratch'));
  Seating.release(m);
});
test('stale release preserves a later stance and unrelated action animation',()=>{
  const m=match(),p=m.players[0];Seating.seat(m);
  const later=[808,823,819,820,821,822,824];
  p.setRenderAnimations(later);
  p.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  p.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId('human_ready')));
  const action=p.getAnimation();Seating.release(m);
  assert.equal(p.getRenderAnimations(),later);
  assert.equal(p.getAnimation(),action);
});
test('old match cleanup cannot erase a replacement match stance',()=>{
  const first=match(),second={players:first.players,state:{turn:1}};
  Seating.seat(first);Seating.seat(second);
  const owned=second.players[0].getRenderAnimations();
  Seating.release(first);
  assert.equal(second.players[0].getRenderAnimations(),owned);
  Seating.release(second);
  assert.equal(second.players[0].getRenderAnimations(),null);
});

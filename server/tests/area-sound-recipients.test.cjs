const assert = require('node:assert/strict');
const {test,before} = require('node:test');
const path = require('node:path');
const {Server} = require('../dist/Server'); Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {Sounds} = require('../dist/game/Sounds');
const {Sound} = require('../dist/game/Sound');
const {World} = require('../dist/game/World');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {Location} = require('../dist/game/model/Location');
const {PrivateArea} = require('../dist/game/model/areas/impl/PrivateArea');
const {encodeSound} = require('../dist/net/protocol/ClientProtocol');
before(async()=>CachePipeline.initialize(path.resolve(__dirname,'..')));

test('entity area sounds respect overlapping rooms and optional recipient exclusion without changing private synths',t=>{
  const room = new PrivateArea(), otherRoom = new PrivateArea();
  let index=800;
  function actor(x,area=room,z=0,bot=false){
    const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const session=new PlayerSession(channel),p=new Player(session),packets=[];
    p.setIndex(index++);p.setUsername('audio'+p.getIndex());p.setLocation(new Location(x,3200,z));p.setRegistered(true);p.setPlayerBot(bot);
    if(area)area.add(p);
    session.sendClientPacket=frame=>{packets.push(frame);return true};
    t.after(()=>p.setRegistered(false));
    return {p,packets};
  }
  const attacker=actor(3200),target=actor(3201),near=actor(3202);
  const other=actor(3202,otherRoom),publicPlayer=actor(3202,null),publicNear=actor(3203,null),bot=actor(3202,room,0,true);
  const far=actor(3220),upstairs=actor(3202,room,1);
  const all=[attacker,target,near,other,publicPlayer,publicNear,bot,far,upstairs];
  t.mock.method(World,'getPlayers',()=>all.map(x=>x.p));
  const expected=encodeSound(3731,{x:3201,y:3200,level:0,loops:1,delay:0,radius:10,attenuation:0});
  Sounds.playAreaSoundAt(target.p,Sound.DARK_BOW_DOUBLEFIRE,10);
  for(const a of [attacker,target,near])assert.deepEqual(a.packets,[expected]);
  for(const a of [other,publicPlayer,publicNear,bot,far,upstairs])assert.deepEqual(a.packets,[],'another room/world/plane, bot or distant recipient receives nothing');
  all.forEach(a=>a.packets.length=0);
  Sounds.playAreaSound({soundId:3731,x:3201,y:3200,radius:10,source:target.p,exclude:attacker.p});
  assert.deepEqual(attacker.packets,[],'a private launch recipient is excluded from its target-area counterpart');
  assert.deepEqual(target.packets,[expected]);assert.deepEqual(near.packets,[expected]);
  for(const a of [other,publicPlayer,publicNear,bot,far,upstairs])assert.deepEqual(a.packets,[]);
  all.forEach(a=>a.packets.length=0);
  Sounds.playAreaSoundAt(publicPlayer.p,Sound.DARK_BOW_DOUBLEFIRE,10);
  const worldPacket=encodeSound(3731,{x:3202,y:3200,level:0,loops:1,delay:0,radius:10,attenuation:0});
  for(const a of [publicPlayer,publicNear])assert.deepEqual(a.packets,[worldPacket]);
  for(const a of [attacker,target,near,other,bot,far,upstairs])assert.deepEqual(a.packets,[],'public entity sounds do not leak into overlapping private rooms');
  all.forEach(a=>a.packets.length=0);
  Sounds.playAreaSoundAt(bot.p,Sound.DARK_BOW_DOUBLEFIRE,10);
  for(const a of [attacker,target,near])assert.deepEqual(a.packets,[worldPacket],'a bot source emits explicit area sounds to nearby humans');
  for(const a of [other,publicPlayer,publicNear,bot,far,upstairs])assert.deepEqual(a.packets,[]);
  all.forEach(a=>a.packets.length=0);
  Sounds.sendSound(attacker.p,Sound.SHOOT_ARROW);
  assert.deepEqual(attacker.packets,[encodeSound(Sound.SHOOT_ARROW.getId(),{loops:1,delay:0})]);
  for(const a of all.filter(a=>a!==attacker))assert.deepEqual(a.packets,[],'ordinary synth sound remains private');
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { CombatSpecial } = require('../dist/game/content/combat/CombatSpecial');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { Item } = require('../dist/game/model/Item');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
for (const plugin of ['DragonAxe', 'DragonPickaxe']) {
  require(`../plugins/combat/specials/${plugin}.SpecialAttack`)({
    core: PluginManager.getCoreApi(), registerCombatSpecial: CombatSpecial.register,
  });
}

for (const [name, weaponId, soundId] of [
  ['Lumber Up', ItemIdentifiers.DRAGON_AXE, 2531],
  ['Rock Knocker', ItemIdentifiers.DRAGON_PICKAXE, 2655],
]) {
  test(`${name} actual special sound stays in the source private area and public world`, t => {
    const room = new PrivateArea(), otherRoom = new PrivateArea();
    const actors = [];
    function actor(name, area) {
      const frames = [];
      const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
        send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
      const session = new PlayerSession(channel), p = new Player(session);
      p.setUsername(name); p.setAttribute('bot-skip-persistence', true);
      session.sendClientPacket = frame => { frames.push(frame); return true; };
      assert.equal(World.getPlayers().add(p), true, 'real world registry allocates the player index and runs login');
      p.setLocation(new Location(3200, 3200, 0));
      if (area) area.add(p);
      actors.push({ p, frames });
      return actors.at(-1);
    }
    t.after(() => {
      for (const { p } of actors) {
        TaskManager.cancelTasks(p);
        World.getPlayers().removes(p);
      }
    });
    const source = actor('toolsource', room), same = actor('toolsame', room);
    const other = actor('toolother', otherRoom), publicPlayer = actor('toolpublic', null);
    source.p.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(weaponId, 1));
    CombatSpecial.assign(source.p);
    const expected = encodeSound(soundId, { x: 3200, y: 3200, level: 0, loops: 1, delay: 0, radius: 1, attenuation: 0 });
    const sounds = a => a.frames.filter(frame => frame[0] === expected[0]);
    const reset = () => { for (const a of actors) a.frames.length = 0; source.p.setSpecialPercentage(100); };
    reset();
    CombatSpecial.activate(source.p);
    assert.deepEqual(sounds(source), [expected]);
    assert.deepEqual(sounds(same), [expected]);
    assert.deepEqual(sounds(other), [], 'same tile in another private room must not hear the tool special');
    assert.deepEqual(sounds(publicPlayer), [], 'same tile in the public world must not hear the private special');
    room.remove(source.p);
    reset();
    CombatSpecial.activate(source.p);
    assert.deepEqual(sounds(source), [expected]);
    assert.deepEqual(sounds(publicPlayer), [expected], 'null-area source still reaches nearby public players');
    assert.deepEqual(sounds(same), []);
    assert.deepEqual(sounds(other), []);
    reset();
    Sounds.playAreaSound({ soundId, x: 3200, y: 3200, level: 0, loops: 1, delay: 0, radius: 1 });
    for (const a of actors) assert.deepEqual(sounds(a), [expected], 'explicit source-less global policy is unchanged');
  });
}

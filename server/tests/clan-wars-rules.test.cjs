const assert = require("node:assert/strict");
const { test } = require("node:test");
const Rules = require("../plugins/minigames/clanwars/Rules.ClanWars");

test("revision 241 cap indices include 1v1, 50v50 and 100v100 with an absolute 100 maximum", () => {
  const expected = [100, 1, 5, 10, 15, 20, 50, 100];
  for (let index = 0; index < expected.length; index++) {
    const rules = Rules.create(index);
    assert.equal(Rules.validate(rules), true);
    assert.equal(Rules.teamCap(rules), expected[index]);
  }
  for (const invalid of [-1, 8, 30, 1.5, "1", null, NaN, Infinity]) {
    assert.equal(Rules.create(invalid), null, `cap index ${String(invalid)}`);
  }
});

test("unsupported modes, arenas and combat restrictions cannot be accepted as the offered rules", () => {
  const changes = {
    wincondition: 15, arena: 4.5, melee: 1, ranged: 0, magic: 0, prayer: 3,
    food: 2, drinks: 2, specialattacks: 3, stragglers: 2, freezing: 1,
    pjtimer: 1, tots: 1, singlespells: 1, leavingcc: 2, rejoiningdelay: 2, vls: 1,
  };
  for (const [key, value] of Object.entries(changes)) {
    const rules = { ...Rules.create(), [key]: value };
    assert.equal(Rules.validate(rules), false, key);
    assert.equal(Rules.teamCap(rules), null, key);
    assert.equal(Rules.summary(rules), null, key);
  }
});

test("incomplete and extended configurations are refused instead of silently changing agreed rules", () => {
  for (const value of [null, undefined, 0, "", [], {}]) assert.equal(Rules.validate(value), false);
  for (const key of Object.keys(Rules.OFFERED_RULES)) {
    const missing = Rules.create();
    delete missing[key];
    assert.equal(Rules.validate(missing), false, key);
    assert.equal(Rules.validate({ ...Rules.create(), [key]: "0" }), false, key);
  }
  assert.equal(Rules.validate({ ...Rules.create(), dangerous: 1 }), false);
  assert.equal(Rules.validate({ ...Rules.create(), [Symbol("hidden-rule")]: 1 }), false);
  assert.equal(Rules.validate(Object.create(Rules.OFFERED_RULES)), false);
  const accessor = Rules.create();
  Object.defineProperty(accessor, "arena", { get() { throw new Error("must not execute rule accessors"); } });
  assert.equal(Rules.validate(accessor), false);
});

test("confirmation describes safe last-standing entry cutoff and supplies without promising inventory restoration", () => {
  const summary = Rules.summary(Rules.create(2));
  assert.match(summary, /Last team standing on Plateau/);
  assert.match(summary, /5 v 5/);
  assert.match(summary, /Safe deaths: you keep your items/);
  assert.match(summary, /No joining or rejoining after/);
  assert.match(summary, /Food and drinks are consumed normally/);
  assert.match(summary, /Melee combat only/);
  assert.match(summary, /Powered staves and Vesta's blighted longsword are not enabled/);
  assert.match(Rules.summary(Rules.create()), /maximum 100 fighters per team/);
});


test("revision 242 kill targets preserve fixed melee terms and reject deferred native modes", () => {
  const targets = [25,50,100,200,500,1000,5000,10000];
  for (let mode=1; mode<=8; mode++) {
    const rules=Rules.create(3,mode);
    assert.equal(Rules.validate(rules),true);
    assert.equal(Rules.killTarget(rules),targets[mode-1]);
    assert.equal(Rules.teamCap(rules),10);
    assert.equal(rules.ranged,1); assert.equal(rules.magic,4);
    assert.match(Rules.summary(rules),/First to .* kills on Plateau/);
    assert.match(Rules.summary(rules),/Joining and rejoining remain open/);
    assert.match(Rules.summary(rules),/Food and drinks are consumed normally/);
  }
  for (const mode of [-1,9,15,21,23,24,1.5,"1",null,NaN]) assert.equal(Rules.create(0,mode),null);
});


test("revision 242 timed modes use sourced durations with fixed melee and respawning terms", () => {
  const minutes = [5, 10, 20, 60, 120];
  const ticks = [500, 1000, 2000, 6000, 12000];
  for (let i = 0; i < minutes.length; i++) {
    const rules = Rules.create(2, 16 + i);
    assert.equal(Rules.validate(rules), true);
    assert.equal(Rules.timeLimitTicks(rules), ticks[i]);
    assert.equal(Rules.killTarget(rules), 0);
    assert.equal(Rules.respawns(rules), true);
    assert.equal(Rules.teamCap(rules), 5);
    assert.equal(rules.ranged, 1); assert.equal(rules.magic, 4);
    assert.match(Rules.summary(rules), new RegExp(`Most kills in ${minutes[i]} minutes on Plateau`));
    assert.match(Rules.summary(rules), /Equal scores end without a winner/);
    assert.match(Rules.summary(rules), /Joining and rejoining remain open/);
  }
  assert.equal(Rules.timeLimitTicks(Rules.create()), 0);
  assert.equal(Rules.respawns(Rules.create()), false);
  assert.equal(Rules.timeLimitTicks(Rules.create(0, 1)), 0);
  assert.equal(Rules.respawns(Rules.create(0, 1)), true);
  assert.equal(Rules.timeLimitTicks(null), null);
});


test("revision 242 restriction enums compose with each supported battle family without changing melee terms", () => {
  for (const mode of [0,1,16,20]) for (const food of [0,1]) for (const drinks of [0,1])
    for (const prayer of [0,1,2]) for (const specialattacks of [0,2]) {
      const base=Rules.create(2,mode), rules={...base,food,drinks,prayer,specialattacks};
      assert.equal(Rules.validate(rules),true);
      assert.equal(Rules.teamCap(rules),Rules.teamCap(base));
      assert.equal(Rules.killTarget(rules),Rules.killTarget(base));
      assert.equal(Rules.timeLimitTicks(rules),Rules.timeLimitTicks(base));
      assert.equal(rules.ranged,1); assert.equal(rules.magic,4); assert.equal(rules.melee,0);
      const text=Rules.summary(rules);
      assert.match(text,new RegExp(`Food: ${food?'disabled':'allowed'}`));
      assert.match(text,new RegExp(`Drinks: ${drinks?'disabled':'allowed'}`));
      assert.match(text,new RegExp(`Melee special attacks: ${specialattacks===2?'disabled':'allowed'}`));
      assert.match(text,/Safe deaths: you keep your items/);
      if (prayer===1) assert.match(text,/overhead icons are disabled; other prayers are allowed/);
      else assert.match(text,prayer===2?/Prayers are disabled/:/All prayers are allowed/);
      const supplyText = food && drinks ? 'Food and drinks are disabled.' : food
        ? 'Allowed drinks are consumed normally.' : drinks ? 'Allowed food is consumed normally.'
          : 'Food and drinks are consumed normally.';
      assert.ok(text.includes(supplyText), 'confirmation describes only permitted supplies');
    }
});

test("membership terms preserve each battle family and reject unsupported departure or delay values", () => {
  for (const mode of [0,1,8,16,20]) for (const leavingcc of [0,1]) for (const rejoiningdelay of [0,1]) {
    const rules={...Rules.create(2,mode),leavingcc,rejoiningdelay};
    assert.equal(Rules.validate(rules),true);
    const text=Rules.summary(rules);
    assert.match(text,leavingcc?/Leaving the chat-channel incurs no death penalty/:/Leaving the chat-channel counts as a death/);
    assert.match(text,rejoiningdelay ? mode ? /60-second wait/ : /60-second rejoining delay cannot reopen entry/
      : /no additional rejoining delay/);
    if (!mode && rejoiningdelay) assert.doesNotMatch(text,/returning to this battle requires a 60-second wait/);
    if (rejoiningdelay) assert.doesNotMatch(text,/rejoining is unrestricted/);
    if (!mode) assert.match(text,/No joining or rejoining after/);
  }
  for (const key of ['leavingcc','rejoiningdelay']) for (const value of [-1,2,0.5,'1',null,NaN,Infinity]) {
    assert.equal(Rules.validate({...Rules.create(),[key]:value}),false);
  }
});

test("revision 242 stragglers thresholds are supported only for Last Team Standing", () => {
  assert.deepEqual(Rules.STRAGGLER_LIMITS,[0,5]);
  for (const playercap of [0,1,2,3,7]) for (const stragglers of [0,1]) {
    const rules={...Rules.create(playercap,0),stragglers};
    assert.equal(Rules.validate(rules),true,'the variant invents no minimum team cap');
    const text=Rules.summary(rules);
    assert.match(text,stragglers?/Ignore 5.*five or fewer fighters remaining loses/:/Kill 'em all.*no fighters remaining loses/);
    if (stragglers) assert.match(text,/both teams have five or fewer fighters.*without a winner/);
  }
  for (const mode of [1,8,16,20]) {
    assert.equal(Rules.validate({...Rules.create(3,mode),stragglers:0}),true);
    assert.equal(Rules.validate({...Rules.create(3,mode),stragglers:1}),false);
  }
  for (const stragglers of [-1,2,0.5,'1',null,NaN,Infinity]) {
    assert.equal(Rules.validate({...Rules.create(),stragglers}),false);
  }
});

test("unsupported or malformed restriction choices cannot enter an otherwise valid negotiated offer", () => {
  for (const key of ['food','drinks','prayer','specialattacks']) {
    const values=key==='prayer'?[-1,3,4]:key==='specialattacks'?[-1,1.5,3]:[-1,2,3];
    for (const value of [...values,0.5,'1',null,NaN,Infinity]) {
      assert.equal(Rules.validate({...Rules.create(2,16),[key]:value}),false,`${key}:${String(value)}`);
    }
  }
});

test('Sylvan and Plateau arena rules retain supported modes and reject other layouts', () => {
  for (const arena of [1, 2]) for (const mode of [0, 1, 8, 16, 20]) {
    const rules = { ...Rules.create(2, mode), arena };
    assert.equal(Rules.validate(rules), true);
    assert.match(Rules.summary(rules), new RegExp(arena === 1 ? 'Plateau' : 'Sylvan Glade'));
  }
  for (const arena of [-1, -2, 4.5, 13.5, 14, 1.5, '2']) {
    assert.equal(Rules.validate({ ...Rules.create(), arena }), false);
  }
});


test('Quarry is a bounded third arena for existing modes while other arenas stay refused', () => {
  for (const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:3};
    assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Forsaken Quarry/);
  }
  assert.equal(Rules.validate({...Rules.create(),arena:4.5}),false);
});


test('Soggy Swamp is arena6 for supported melee modes while unsupported arenas remain refused',()=>{
  for(const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:6};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Soggy Swamp/);
  }
  for(const arena of [0.5,4.5,5.5,7.5,8.5,9.5,10,11.5,12.5,13.5,14,-1,6.5,'6',NaN,Infinity]) assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Clan Cup is arena5 for supported melee modes while unsupported and malformed arena choices stay refused',()=>{
  for(const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:5};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Clan Cup Arena/);
  }
  for(const arena of [0.5,4.5,7.5,8.5,9.5,10,11.5,12.5,13.5,14,-1,5.5,'5',NaN,Infinity]) assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Classic arena11 preserves supported melee modes and refuses unsupported or malformed choices',()=>{
  for(const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:11};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Classic/);
  }
  for(const arena of [0.5,4.5,7.5,8.5,9.5,10,12.5,13.5,14,-1,11.5,'11',NaN,Infinity]) assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Lumbridge Castle arena12 preserves supported melee modes and rejects malformed choices',()=>{
  for(const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:12};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Lumbridge Castle/);
  }
  for(const arena of [0.5,4.5,7.5,8.5,9.5,10,13.5,14,-1,12.5,'12',NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Falador Park arena13 preserves supported melee modes and rejects malformed choices',()=>{
  for(const mode of [0,1,8,16,20]) {
    const rules={...Rules.create(3,mode),arena:13};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Falador Park/);
  }
  for(const arena of [0.5,4.5,7.5,8.5,9.5,10,14,-1,13.5,'13',NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});

test('Wasteland numeric zero preserves explicit Plateau default and supported mode summaries',()=>{
  assert.equal(Rules.create().arena,1);assert.equal(Rules.OFFERED_RULES.arena,1);
  for(const mode of [0,1,8,16,20]){const rules={...Rules.create(3,mode),arena:0};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),/Wasteland/);assert.equal(rules.arena,0);}
  for(const arena of [null,undefined,false,'0',NaN,Infinity,-1,0.5,4.5,7.5,8.5,9.5,10,13.5,14])assert.equal(Rules.validate({...Rules.create(),arena}),false);
  const missing={...Rules.create()};delete missing.arena;assert.equal(Rules.validate(missing),false);assert.equal(Rules.create().arena,1);
});


test('Turrets arena4 retains existing melee modes, default Plateau and explicit Wasteland',()=>{
  assert.equal(Rules.create().arena,1);
  for(const arena of [0,4])for(const mode of [0,1,8,16,20]){
    const rules={...Rules.create(3,mode),arena};assert.equal(Rules.validate(rules),true);assert.match(Rules.summary(rules),new RegExp(arena===4?'Turrets':'Wasteland'));assert.equal(rules.ranged,1);assert.equal(rules.magic,4);assert.equal(rules.melee,0);
  }
  for(const arena of [null,undefined,false,'4',4.5,-1,7.5,14,NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Northleach arena8 preserves default Plateau explicit Wasteland and all existing melee families',()=>{
  assert.equal(Rules.create().arena,1);assert.equal(Rules.OFFERED_RULES.arena,1);
  for(const arena of[0,1,2,3,4,5,6,8,11,12,13])for(const mode of[0,1,8,16,20]){const rules={...Rules.create(3,mode),arena};assert.equal(Rules.validate(rules),true);assert.equal(rules.arena,arena);assert.equal(rules.melee,0);assert.equal(rules.ranged,1);assert.equal(rules.magic,4);if(arena===8)assert.match(Rules.summary(rules),/Northleach Quell/);}
  for(const arena of[null,undefined,false,'8',8.5,7.5,9.5,10,14,-1,NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


test('Ghastly arena7 preserves all twelve layouts and existing melee restrictions',()=>{
  assert.equal(Rules.create().arena,1);
  for(const arena of[0,1,2,3,4,5,6,7,8,11,12,13])for(const mode of[0,1,8,16,20])for(const food of[0,1])for(const drinks of[0,1]){
    const rules={...Rules.create(3,mode),arena,food,drinks,specialattacks:2};
    assert.equal(Rules.validate(rules),true);assert.equal(rules.arena,arena);assert.equal(rules.melee,0);assert.equal(rules.ranged,1);assert.equal(rules.magic,4);
    if(arena===7)assert.match(Rules.summary(rules),/Ghastly Swamp/);
  }
  for(const arena of[null,undefined,false,'7',7.5,9.5,10,14,-1,NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});

test('Gridlock arena9 preserves all thirteen layouts and supported melee rule families',()=>{
  assert.equal(Rules.create().arena,1);assert.equal(Rules.OFFERED_RULES.arena,1);
  for(const arena of[0,1,2,3,4,5,6,7,8,9,11,12,13])for(const mode of[0,1,8,16,20])for(const food of[0,1])for(const drinks of[0,1]){
    const rules={...Rules.create(3,mode),arena,food,drinks,specialattacks:2};assert.equal(Rules.validate(rules),true);assert.equal(rules.arena,arena);assert.equal(rules.melee,0);assert.equal(rules.ranged,1);assert.equal(rules.magic,4);if(arena===9)assert.match(Rules.summary(rules),/Gridlock/);
  }
  for(const arena of[null,undefined,false,'9',9.5,10,14,-1,NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),arena}),false);
});


// T: the new option is offered only inside the existing fixed-Magic-Disabled slice.
test('No Staff option1 composes with all thirteen layouts and supported melee modes',()=>{
  for(const arena of[0,1,2,3,4,5,6,7,8,9,11,12,13])for(const mode of[0,1,8,16,20])for(const specialattacks of[0,1,2]){
    const rules={...Rules.create(3,mode),arena,specialattacks};
    assert.equal(Rules.validate(rules),true,`${arena}/${mode}/${specialattacks}`);
    assert.equal(rules.magic,4);assert.equal(rules.ranged,1);assert.equal(rules.melee,0);
    const text=Rules.summary(rules);
    if(specialattacks===1){assert.match(text,/No Staff of the Dead; other permitted specials are allowed/);assert.match(text,/Power of Death is already unavailable while Magic is disabled/);}
    else assert.match(text,new RegExp(`Melee special attacks: ${specialattacks===2?'disabled':'allowed'}`));
    assert.equal(Rules.killTarget(rules),Rules.killTarget(Rules.create(3,mode)));
    assert.equal(Rules.timeLimitTicks(rules),Rules.timeLimitTicks(Rules.create(3,mode)));
  }
});

test('No Staff option never enables other magic or unsupported objective configurations',()=>{
  for(const magic of[0,2,3])assert.equal(Rules.validate({...Rules.create(),specialattacks:1,magic}),false);
  assert.equal(Rules.validate({...Rules.create(),specialattacks:1,magic:1}),true,'No Staff composes with the newly supported Standard option');
  for(const wincondition of[9,10,11,12,13,14,15,21,22,23])assert.equal(Rules.validate({...Rules.create(),specialattacks:1,wincondition}),false);
  for(const specialattacks of[-1,3,0.5,'1',null,NaN,Infinity])assert.equal(Rules.validate({...Rules.create(),specialattacks}),false);
});

test('finite Standard elemental Magic negotiates 1 or Disabled4 while retaining the default and deferred choices',()=>{
  assert.equal(Rules.create().magic,4);
  for(const magic of[1,4]){
    const rules={...Rules.create(2,1),magic};assert.equal(Rules.validate(rules),true);assert.equal(Rules.teamCap(rules),5);assert.equal(Rules.killTarget(rules),25);
    assert.equal(rules.ranged,1);assert.equal(rules.melee,0);
  }
  for(const magic of[0,2,3,5,-1,1.5,'1',null,NaN])assert.equal(Rules.validate({...Rules.create(),magic}),false);
});

test('Standard Magic summary honestly composes bounded loadouts, normal costs, queued-hit boundaries and NoStaff',()=>{
  const rules={...Rules.create(2,16),magic:1,specialattacks:1,leavingcc:1,rejoiningdelay:1};assert.equal(Rules.validate(rules),true);
  const terms=Rules.summary(rules);assert.match(terms,/20 strike/);assert.match(terms,/basic\/elemental staves/);assert.match(terms,/empty offhand or an elemental tome/);
  assert.match(terms,/not restored/);assert.match(terms,/queued battle hits without refund/);assert.match(terms,/Power of Death and other magical specials remain unsupported/);
  assert.match(terms,/Ranged combat is disabled/);assert.doesNotMatch(terms,/Magic is disabled/);assert.equal(Rules.timeLimitTicks(rules),500);
  assert.match(Rules.summary(Rules.create()),/Melee combat only\. Ranged and magical combat are disabled/);
});

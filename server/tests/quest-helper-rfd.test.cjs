const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRfdRenderer,completionProjection,OWNED_ATTRIBUTES}=require('../plugins/quests/questhelper/RecipeForDisaster.QuestHelper');

function identifiers(name){
 const text=fs.readFileSync(path.join(__dirname,`../src/main/typescript/elvarg/util/${name}.ts`),'utf8');
 return Object.fromEntries([...text.matchAll(/public static (\w+)\s*=\s*(\d+)/g)].map(m=>[m[1],Number(m[2])]));
}
const core={ItemIdentifiers:identifiers('ItemIdentifiers'),NpcIdentifiers:identifiers('NpcIdentifiers'),ObjectIdentifiers:identifiers('ObjectIdentifiers'),Skill:{COOKING:'COOKING',AGILITY:'AGILITY',FIREMAKING:'FIREMAKING'},Equipment:{WEAPON_SLOT:3,AMULET_SLOT:2,HEAD_SLOT:0,CAPE_SLOT:1,HANDS_SLOT:9}};
const I=core.ItemIdentifiers,N=core.NpcIdentifiers,O=core.ObjectIdentifiers;
const V=['START','DWARF','WARTFACE_AND_BENTNOZE','PIRATE_PETE','LUMBRIDGE_GUIDE','EVIL_DAVE','SKRACH_UGLOGWEE','SIR_AMIK_VARZE','MONKEY_AMBASSADOR','FINALE'];
const bits=[1,2,4,8,16,32,64,128];
function fixture({stage=4,flags=0,attrs={},inventory={},equipment={},levels={},incomplete=[],location=[3235,3219,0],snapshot={}}={}){
 const reads=[];const values={'quest.recipe_for_disaster.stage':stage,'quest.points':200,'recipe-for-disaster:rescues':flags,...Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.includes(':')||k.startsWith('quest.')?k:`recipe-for-disaster:${k}`,v]))};
 const itemList=record=>Object.entries(record).map(([key,quantity])=>({getId:()=>Number(key)||I[key],getAmount:()=>quantity}));
 const inv={getAmount:id=>itemList(inventory).filter(i=>i.getId()===id).reduce((n,i)=>n+i.getAmount(),0),getItems:()=>itemList(inventory),getFreeSlots:()=>28-itemList(inventory).length};
 const eq={getItems:()=>itemList(equipment),get:slot=>equipment[slot]?{getId:()=>I[equipment[slot]]??equipment[slot]}:null};
 const player={getAttribute:key=>{reads.push(key);return values[key];},getInventory:()=>inv,getEquipment:()=>eq,getLocation:()=>({getX:()=>location[0],getY:()=>location[1],getZ:()=>location[2]}),getSkillManager:()=>({getCurrentLevel:s=>levels[s]??99}),getWeight:()=>0};
 const getQuests=()=>[{key:'recipe_for_disaster',getStage:()=>stage,isComplete:()=>stage>=5,isStarted:()=>stage>0},...new Set(['cooks_assistant','fishing_contest','goblin_diplomacy','big_chompy_bird_hunting','biohazard','demon_slayer','murder_mystery','nature_spirit','witchs_house','gertrudes_cat','shadow_of_the_storm','monkey_madness_i','desert_treasure_i','horror_from_the_deep','family_crest','heroes_quest','lost_city','merlins_crystal','shield_of_arrav','dragon_slayer_i','shilo_village','jungle_potion','druidic_ritual','underground_pass','plague_city','waterfall_quest','legends_quest'])].map(q=>typeof q==='string'?{key:q,isComplete:()=>!incomplete.includes(q),getStage:()=>incomplete.includes(q)?0:10}:q);
 const request={protocol:1,session:'rfd-fixture',sequence:1,questKey:'recipe_for_disaster',snapshot,events:[]};
 const render=createRfdRenderer({core,getQuests});
 return {reads,player,request,run:variant=>render({...request,helperVariant:`RECIPE_FOR_DISASTER_${variant}`},player)};
}
function step(options,variant){const result=fixture(options).run(variant);assert.equal(result.status,'active',JSON.stringify(result));assert.ok(result.activeStep.targets.length);return result.activeStep;}

test('all 256 rescue masks independently complete exactly the rescued components',()=>{
 for(let flags=0;flags<256;flags++)for(let n=0;n<8;n++){
  const r=fixture({flags}).run(V[n+1]);
  assert.equal(r.status,flags&bits[n]?'complete':'active',`${flags}/${V[n+1]}`);
 }
});
test('every referenced identifier exists in the actual server core tables',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/quests/questhelper/RecipeForDisaster.QuestHelper.js'),'utf8');
 for(const match of source.matchAll(/\b([INO])\.(\w+)/g))assert.ok(Number.isInteger(({I,N,O})[match[1]][match[2]]),match[0]);
});
test('opening and finale eligibility follows server stages, rescue flags and prerequisites',()=>{
 assert.match(step({stage:0},'START').id,/opening-start/);
 assert.match(step({stage:1},'START').id,/opening-/);
 assert.equal(fixture({stage:4}).run('START').status,'complete');
 for(const v of V)assert.equal(fixture({stage:5}).run(v).status,'complete');
 for(const v of V.slice(1))assert.match(step({stage:0},v).id,/opening-required/);
 assert.match(step({flags:0},'FINALE').id,/final-rescues/);
 assert.match(step({flags:255,incomplete:['desert_treasure_i']},'FINALE').id,/requirements/);
 assert.match(step({flags:255},'FINALE').id,/final-aris/);
});
test('all ten routes have actual targets and echo the bounded protocol',()=>{
 for(const v of V){const f=fixture({stage:v==='START'?1:4});const r=f.run(v);assert.equal(r.protocol,1);assert.equal(r.questKey,f.request.questKey);assert.equal(r.session,f.request.session);assert.equal(r.sequence,1);assert.ok(r.activeStep.text.length);assert.ok(r.activeStep.targets.every(t=>t.kind==='tile'||Number.isInteger(t.id)));assert.deepEqual(r.diagnostics,[]);}
 const rescue=step({inventory:{DWARVEN_ROCK_CAKE_2:1}},'DWARF');
 assert.ok(rescue.targets.some(t=>t.id===N.MOUNTAIN_DWARF&&t.x===3236&&t.y===3219));
});
test('renderer only reads its whitelist and is restart-safe; hidden Dave recipe stays private',()=>{
 const opts={attrs:{'evil-dave-state':3,'evil-dave-recipe':{red:3},'evil-dave-stew':{doses:{red:1}}},inventory:{SPICY_STEW:1}};
 const a=fixture(opts),b=fixture(opts);assert.deepEqual(a.run('EVIL_DAVE'),b.run('EVIL_DAVE'));
 assert.ok(a.reads.every(k=>OWNED_ATTRIBUTES.includes(k)),a.reads.join(','));assert.ok(!a.reads.includes('recipe-for-disaster:evil-dave-recipe'));
 assert.throws(()=>createRfdRenderer({core:{...core,ItemIdentifiers:{}},getQuests:()=>[]}),/identifier/i);
});
test('opening ingredients and dirty blast use actual item-on-item progression',()=>{
 assert.match(step({stage:1,inventory:{FRUIT_BLAST:1,ASHES:1}},'START').id,/dirty-blast/);
 assert.match(step({stage:1,inventory:{DIRTY_BLAST:1,EYE_OF_NEWT:1,GREENMANS_ALE:1,ROTTEN_TOMATO:1}},'START').id,/handover/);
 assert.ok(step({stage:0,levels:{COOKING:1}},'START').requirements.some(r=>r.name==='Cooking 10'&&!r.met));
});
test('Dwarf branches use actual ale counters, bartender knowledge, cake dialogue and cooling',()=>{
 const cases=[[{},'dwarf-rohak'],[{'dwarf-state':16},'dwarf-ale'],[{'dwarf-state':4},'dwarf-drunk'],[{'dwarf-state':0x200},'dwarf-sober'],[{'dwarf-state':0x400},'dwarf-ingredients'],[{'dwarf-state':0x800},'dwarf-cake']];
 for(const [attrs,id]of cases)assert.equal(step({attrs},'DWARF').id,id);
 assert.match(step({inventory:{DWARVEN_ROCK_CAKE:1}},'DWARF').id,/cool/);
 assert.match(step({inventory:{DWARVEN_ROCK_CAKE_2:1}},'DWARF').id,/rescue/);
});
test('Goblins preserve charcoal, every ingredient conversion and slop handover',()=>{
 const cases=[[{}, {},'goblin-charcoal'],[{'goblin-state':2},{},'goblin-bread'],[{'goblin-state':2},{SOGGY_BREAD:1},'goblin-orange'],[{'goblin-state':2},{SOGGY_BREAD:1,ORANGE_SLICES:1},'goblin-dye'],[{'goblin-state':2},{SOGGY_BREAD:1,DYED_ORANGE:1},'goblin-spice'],[{'goblin-state':2},{SOGGY_BREAD:1,DYED_ORANGE:1,SPICY_MAGGOTS:1},'goblin-slop'],[{}, {SLOP_OF_COMPROMISE:1},'rescue']];
 for(const[attrs,inventory,id]of cases)assert.ok(step({attrs,inventory},'WARTFACE_AND_BENTNOZE').id.includes(id));
});
test('Pete follows Aris/Cook, Murphy, diving, hides, wire, crab and actual recipe stages',()=>{
 const cases=[[{}, {},'pete-aris'],[{'pirate-state':16},{},'pete-cook'],[{'pirate-state':17},{},'pete-gear'],[{'pirate-state':19},{},'pete-dive'],[{'pirate-state':23},{},'pete-kelp'],[{'pirate-state':23},{KELP:1},'pete-rocks'],[{'pirate-state':23},{KELP:1,ROCK_7:5},'pete-hides'],[{'pirate-state':23,'pirate-hides-given':5},{KELP:1,ROCK_7:5},'pete-wire'],[{'pirate-state':31,'pirate-hides-given':5},{KELP:1,ROCK_7:5},'pete-crab'],[{'pirate-state':31},{KELP:1,GIANT_CRAB_MEAT:1},'pete-surface'],[{'pirate-state':16}, {RAW_FISHCAKE:1},'pete-cook-cake']];
 for(const[attrs,inventory,id]of cases)assert.equal(step({attrs,inventory},'PIRATE_PETE').id,id);
});
test('Guide enchanted flags do not substitute for lost ingredients; all three ingredients are checked',()=>{
 assert.match(step({attrs:{'guide-state':7}},'LUMBRIDGE_GUIDE').id,/guide-enchant/);
 assert.match(step({inventory:{ENCHANTED_EGG:1,ENCHANTED_MILK:1,ENCHANTED_FLOUR:1,CAKE_TIN:1}},'LUMBRIDGE_GUIDE').id,/guide-mix/);
 assert.match(step({inventory:{RAW_GUIDE_CAKE:1}},'LUMBRIDGE_GUIDE').id,/guide-bake/);
});
test('Dave uses actual talk/recipe-known/taste-approved flags and consumed accepted stew',()=>{
 for(const[bits,id]of[[0,'dave-talk'],[1,'dave-doris'],[3,'dave-spices'],[7,'dave-repeat']])assert.equal(step({attrs:{'evil-dave-state':bits}},'EVIL_DAVE').id,id);
 assert.match(step({attrs:{'evil-dave-state':3},inventory:{SPICY_STEW:1}},'EVIL_DAVE').id,/taste/);
 assert.match(step({attrs:{'evil-dave-state':7},inventory:{SPICY_STEW:1}},'EVIL_DAVE').id,/rescue/);
});
test('Skrach covers all persisted boat bits and inventory-driven hunting/cooking',()=>{
 for(const[bits,id]of[[0,'skrach-rantz'],[1,'skrach-tree'],[3,'skrach-hollow'],[7,'skrach-chompy'],[23,'skrach-return'],[31,'skrach-bellows']])assert.equal(step({attrs:{'skrach-state':bits}},'SKRACH_UGLOGWEE').id,id);
 for(const[item,id]of[['SKEWERED_CHOMPY','skrach-cook-chompy'],['BALLOON_TOAD','skrach-drop'],['BLOATED_TOAD','skrach-balloon'],['RAW_JUBBLY','skrach-cook-jubbly']])assert.equal(step({attrs:{'skrach-state':31},inventory:{[item]:1}},'SKRACH_UGLOGWEE').id,id);
});
test('Amik reads its actual Aris unlock and every server brulee recipe intermediate',()=>{
 assert.match(step({},'SIR_AMIK_VARZE').id,/amik-aris/);
 for(const[item,id]of[['MILKY_MIXTURE','amik-cornflour'],['CORNFLOUR_MIXTURE','amik-vanilla'],['BRULEE','amik-egg'],['BRULEE_2','amik-cinnamon'],['BRULEE_3','amik-token'],['DRAGON_TOKEN','amik-milk']])assert.equal(step({attrs:{'amik-state':1},inventory:{[item]:1}},'SIR_AMIK_VARZE').id,id);
});
test('Awowogei covers recipe mask, three monkey talks, offerings, course, hole and cooking',()=>{
 for(const[bits,id]of[[0,'awowogei-king'],[72,'awowogei-monkeys'],[79,'awowogei-banana-offer'],[95,'awowogei-nuts-offer'],[127,'awowogei-snake']])assert.equal(step({attrs:{'awowogei-state':bits}},'MONKEY_AMBASSADOR').id,id);
 for(const[bits,inventory,id,location]of[[127,{SNAKE_CORPSE:1},'awowogei-filling-choice'],[127,{SNAKE_CORPSE:1,RED_BANANA:1},'awowogei-slice'],[383,{SNAKE_CORPSE:1},'awowogei-hole'],[895,{SNAKE_CORPSE:1},'awowogei-nuts',[3020,5457,0]],[127,{RAW_STUFFED_SNAKE:1},'awowogei-dungeon'],[1151,{RAW_STUFFED_SNAKE:1},'awowogei-cook',[3055,5484,0]]])assert.equal(step({attrs:{'awowogei-state':bits},inventory,location},'MONKEY_AMBASSADOR').id,id);
});
test('finale follows actual persisted checkpoints and all six combat waves',()=>{
 assert.equal(step({flags:255,attrs:{'culinaromancer-wave':-1}},'FINALE').id,'final-enter');
 for(let wave=1;wave<=6;wave++)assert.equal(step({flags:255,attrs:{'culinaromancer-wave':wave},location:[1900,5355,2]},'FINALE').id,`final-wave-${wave}`);
 assert.equal(step({flags:255,attrs:{'culinaromancer-wave':3}},'FINALE').id,'final-resume');
 assert.equal(step({flags:255,attrs:{'culinaromancer-defeated':true}},'FINALE').id,'final-claim');
});
test('cooling uses the real server item-on-dwarf interaction with ice gloves',()=>{
 const s=step({inventory:{DWARVEN_ROCK_CAKE:1},equipment:{9:'ICE_GLOVES'}},'DWARF');
 assert.match(s.text.join(' '),/use.*hot.*Mountain Dwarf/i);
 assert.ok(s.targets.some(t=>t.id===N.MOUNTAIN_DWARF));
});
test('Skrach detects the actual bird/ground drop after the balloon item is consumed',()=>{
 assert.equal(step({attrs:{'skrach-state':31},snapshot:{npcs:[{id:N.JUBBLY_BIRD,x:2631,y:2985,plane:0}]}},'SKRACH_UGLOGWEE').id,'skrach-hunt');
 assert.equal(step({attrs:{'skrach-state':31},snapshot:{groundItems:[{id:I.RAW_JUBBLY,quantity:1,x:2631,y:2985,plane:0}]}},'SKRACH_UGLOGWEE').id,'skrach-loot');
});
test('Traiborn answers match every actual server quiz question in visible widget trees',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../plugins/quests/quests/RecipeForDisaster.Quest.js'),'utf8');
 const quiz=source.slice(source.indexOf('const GUIDE_QUIZZES'),source.indexOf('function shuffled'));
 const questions=[...quiz.matchAll(/^\s+\["((?:\\.|[^"\\])*)", "((?:\\.|[^"\\])*)",/gm)].map(m=>[JSON.parse('"'+m[1]+'"'),JSON.parse('"'+m[2]+'"')]);
 assert.equal(questions.length,28);
 for(const[question,answer]of questions){
  const s=step({snapshot:{widgets:[{id:1,staticChildren:[{id:2,text:`<col=ffffff>${question}</col>`}]}]}},'LUMBRIDGE_GUIDE');
  assert.ok(s.dialogueChoices.some(c=>c.text===answer),question);
 }
});
test('monkey recipe is not learned by speaking without a speech amulet',()=>{
 const s=step({attrs:{'awowogei-state':7}},'MONKEY_AMBASSADOR');
 assert.equal(s.id,'awowogei-king');
 assert.ok(s.requirements.some(r=>r.name.includes("M'speak")&&!r.met));
});
test('completion projection preserves unknown unfinished component state for all 256 masks',()=>{
 const rows=[[1,1892,60],[2,1867,40],[4,1895,110],[8,1896,5],[16,1878,5],[32,1904,170],[64,1910,20],[128,1914,50]];
 for(let flags=0;flags<256;flags++){
  const f=fixture({stage:4,flags}),result=completionProjection(f.player);
  assert.equal(result[1850],flags===255?4:3);
  for(const[flag,id,value]of rows)assert.equal(result[id],flags&flag?value:undefined);
  assert.ok(f.reads.every(k=>OWNED_ATTRIBUTES.includes(k)));
 }
 for(const[stage,expected]of[[0,0],[1,1],[4,3],[5,5]])assert.equal(completionProjection(fixture({stage}).player)[1850],expected);
 const existing={1892:30,1867:10};Object.assign(existing,completionProjection(fixture({flags:1}).player));
 assert.equal(existing[1892],60);assert.equal(existing[1867],10);
 assert.equal(completionProjection(fixture({stage:2}).player)[1850],undefined,'an unimplemented canonical stage is not fabricated');
});
test('lost rock cake requires all four replacement ingredients again',()=>{
 const s=step({attrs:{'dwarf-state':0x800}},'DWARF');
 for(const id of [I.EGG,I.POT_OF_FLOUR,I.BUCKET_OF_MILK,I.BOWL_OF_WATER])assert.ok(s.requirements.some(r=>r.ids?.includes(id)&&!r.met));
});
test('late recipes progress from real carried ingredients and equipped forms',()=>{
 const pete=step({attrs:{'pirate-state':27},inventory:{KELP:1,GIANT_CRAB_MEAT:1}},'PIRATE_PETE');assert.ok(pete.targets.some(t=>t.id===I.PESTLE_AND_MORTAR));
 assert.equal(step({attrs:{'pirate-state':16},inventory:{GROUND_COD:1,GROUND_KELP:1,GROUND_GIANT_CRAB_MEAT:1,BREADCRUMBS:1}},'PIRATE_PETE').id,'pete-mix');
 assert.equal(step({attrs:{'amik-state':1},inventory:{BRULEE:1,EVIL_CHICKENS_EGG:1}},'SIR_AMIK_VARZE').id,'amik-add-egg');
 const flambe=step({attrs:{'amik-state':1},inventory:{BRULEE_3:1,DRAGON_TOKEN:1}},'SIR_AMIK_VARZE');assert.equal(flambe.id,'amik-flambe');assert.ok(flambe.requirements.some(r=>r.ids?.includes(I.ICE_GLOVES)&&!r.met));
 for(const[inventory,id]of[[{SNAKE_CORPSE:1,RED_BANANA:1,TCHIKI_MONKEY_NUTS:1},'awowogei-slice'],[{SNAKE_CORPSE:1,SLICED_RED_BANANA:1,TCHIKI_MONKEY_NUTS:1},'awowogei-stuff'],[{SNAKE_CORPSE:1,SLICED_RED_BANANA:1,TCHIKI_NUT_PASTE:1},'awowogei-stuff']])assert.equal(step({attrs:{'awowogei-state':127},inventory},'MONKEY_AMBASSADOR').id,id);
});
test('either snake filling is sufficient without gathering the other',()=>{
 for(const filling of ['SLICED_RED_BANANA','TCHIKI_NUT_PASTE']){
  const s=step({attrs:{'awowogei-state':127},inventory:{SNAKE_CORPSE:1,[filling]:1}},'MONKEY_AMBASSADOR');
  assert.equal(s.id,'awowogei-stuff');assert.match(s.text.join(' '),/one filling|either filling/i);
  assert.ok(s.targets.some(t=>t.id===I[filling]));
 }
 assert.match(step({attrs:{'awowogei-state':127},inventory:{SNAKE_CORPSE:1}},'MONKEY_AMBASSADOR').text.join(' '),/choose.*one/i);
 assert.equal(step({attrs:{'awowogei-state':127},inventory:{SNAKE_CORPSE:1,TCHIKI_MONKEY_NUTS:1}},'MONKEY_AMBASSADOR').id,'awowogei-grind');
 assert.equal(step({attrs:{'awowogei-state':127},inventory:{RAW_STUFFED_SNAKE:1}},'MONKEY_AMBASSADOR').id,'awowogei-dungeon');
 assert.equal(step({attrs:{'awowogei-state':0},inventory:{RAW_STUFFED_SNAKE:1}},'MONKEY_AMBASSADOR').id,'awowogei-dungeon');
 assert.match(step({attrs:{'awowogei-state':127},inventory:{STUFFED_SNAKE:1}},'MONKEY_AMBASSADOR').id,/rescue/);
});
test('factory resolves quest handles at evaluation after plugin registration completes',()=>{
 let available=[];const render=createRfdRenderer({core,getQuests:()=>available});const f=fixture({stage:5});
 assert.equal(render(f.request,f.player).status,'unavailable');
 available=[{key:'recipe_for_disaster',getStage:()=>5,isComplete:()=>true}];assert.equal(render(f.request,f.player).status,'complete');
});
test('hidden stale quiz widgets cannot override the live ingredient task',()=>{
 assert.equal(step({snapshot:{widgets:[{id:1,hidden:true,text:'How many types of runes were there?'}]}},'LUMBRIDGE_GUIDE').id,'guide-enchant');
});


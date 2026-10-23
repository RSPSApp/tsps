/** Wiki's thirteen potion recipes, eight random statues, and their dolmens. */
module.exports=function registerTemple({api,stage,advance,held,give,val,replace,ATTRIBUTES}){
 const {PrivateArea,Boundary,Location,Item,ItemIdentifiers:I,ItemOnGroundManager,MapObjects,ObjectManager,Skill,Animation}=api.core;
 const PUZZLE_ATTRIBUTE='while-guthix-sleeps:temple-puzzle',POUCHES_ATTRIBUTE='while-guthix-sleeps:temple-pouches';
 ATTRIBUTES.push(PUZZLE_ATTRIBUTE,POUCHES_ATTRIBUTE);
 const SKELETON=54088,SKELETONS=[53813,53814],TABLE=54083,TABLES=[53666,53667,53668,53669,53670,53671,53672,53673,53674];
  const RUBBLE=53639,DOOR=53694,DRUIDS=[13575,13576],SICKLE=I.SILVER_SICKLE_B_,POUCH=I.DRUID_POUCH_2,EMPTY_POUCH=I.DRUID_POUCH,FLOWER=29556;
  // The skeleton hands over one druid pouch holding six charges; the stack of the
  // stackable pouch item is the charge count, and a spent pouch becomes the empty
  // pouch, which the vine flowers refill (Nature Spirit's pouch fill).
  const POUCH_CHARGES=6;
 const DEAD_VINE=53723,FLOWERING_VINE=53724;
 const ENERGY_BRAZIER=53736;
 const RECIPES=[
  ['Agility',53640,29539,[[I.TOADFLAX,I.TOADS_LEGS]]],
  ['Balance',53642,29551,[[I.HARRALANDER,I.RED_SPIDERS_EGGS,I.GARLIC,I.SILVER_DUST]]],
  ['Energy',53644,29540,[[I.HARRALANDER,I.CHOCOLATE_DUST],[I.AVANTOE,I.MORT_MYRE_FUNGUS]]],
  ['Restoration',53646,29541,[[I.HARRALANDER,I.RED_SPIDERS_EGGS],[I.SNAPDRAGON,I.RED_SPIDERS_EGGS]]],
  ['Attack',53648,29542,[[I.GUAM_LEAF,I.EYE_OF_NEWT],[I.IRIT_LEAF,I.EYE_OF_NEWT]]],
  ['Strength',53650,29543,[[I.TARROMIN,I.LIMPWURT_ROOT],[I.KWUARM,I.LIMPWURT_ROOT]]],
  ['Defence',53652,29544,[[I.RANARR_WEED,I.WHITE_BERRIES],[I.CADANTINE,I.WHITE_BERRIES]]],
  ['Combat',53654,29545,[[I.HARRALANDER,I.GOAT_HORN_DUST]]],
  ['Ranging',53656,29546,[[I.DWARF_WEED,I.WINE_OF_ZAMORAK]]],
  ['Prayer',53658,29547,[[I.RANARR_WEED,I.SNAPE_GRASS]]],
  ['Hunter',53660,29548,[[I.AVANTOE,I.KEBBIT_TEETH_DUST]]],
  ['Fishing',53662,29549,[[I.AVANTOE,I.SNAPE_GRASS]]],
  ['Magic',53664,29550,[[I.LANTADYME,I.POTATO_CACTUS]]],
 ];
 const SITES=[
  [4041,4454,0,10868,4045,4450],[4037,4419,3,10869,4039,4420],
  [4040,4375,2,10913,4040,4387],[4091,4374,1,10924,4089,4372],
  [4101,4468,3,10925,4103,4468],[4141,4469,0,10926,4140,4467],
  [4153,4450,1,10927,4150,4451],[4151,4421,2,10928,4153,4424],
 ];
 const sessions=new WeakMap(),spirits=new WeakMap();
 const loc=(x,y,z=0)=>new Location(x,y,z),visible=e=>e.definition?.id??api.core.ObjectDefinition.forPlayer(e.objectId,e.player)?.id??e.objectId;
 function state(p){
  let s=p.getAttribute(PUZZLE_ATTRIBUTE);if(!s){const choices=RECIPES.map((_,i)=>i);for(let i=12;i>0;i--){const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}s={types:choices.slice(0,8),ingredients:Array.from({length:8},()=>[]),finished:0,placed:0,revealed:0};p.setAttribute(PUZZLE_ATTRIBUTE,s);}return s;
 }
 function store(p,s){p.setAttribute(PUZZLE_ATTRIBUTE,s);}
 function sync(p) {
  const puzzle = state(p);
  p.getPacketSender()
   .sendVarbit(10828, count(puzzle.placed))
   .sendVarbit(10815, puzzle.placed === 255 ? 0 : 1)
   .sendVarbit(10810, val(p, POUCHES_ATTRIBUTE) ? 1 : 0);
 }
 function count(mask){let n=0;while(mask){n+=mask&1;mask>>>=1;}return n;}
 function drop(p,id,position){ItemOnGroundManager.registerLocation(p,new Item(id,1),position);}
 function scenery(p,id,x,y,type=10,face=0){
  replace(p,id,[x,y,0],type,face);
 }
 class TempleArea extends PrivateArea{
  constructor(p){super([new Boundary(4032,4159,4352,4543,0)]);this.player=p;this.cast=[];}
  canAttack(a,b){return DRUIDS.includes(b.getId?.())?false:null;}
  process(m){if(m===this.player&&stage(m)>=800&&stage(m)<900&&m.getLocation().getX()>4100&&m.getLocation().getY()<4410)api.emitCustomEvent('wgs:approach-stone',{player:m});}
  postLeave(m,logout){if(m===this.player){for(const n of this.cast)api.removeNpc(n);sessions.delete(m);if(logout)m.moveTo(loc(3229,9527,2));}super.postLeave(m,logout);}
 }
 function refreshStatue(p,i){const s=state(p),[x,y,face]=SITES[i],recipe=RECIPES[s.types[i]];scenery(p,recipe[1]+((s.finished>>i)&1),x,y,10,face);}
 function enter({player:p}){
  if(stage(p)<760)return;if(stage(p)>=900){const previous=p.getArea();if(previous)previous.leave(p,false);p.moveTo(loc(4061,4466));p.getPacketSender().sendVarbit(10815,0);return;}let a=sessions.get(p);if(!a){a=new TempleArea(p);sessions.set(p,a);a.enter(p);p.moveTo(loc(4061,4466));
   for(let i=0;i<8;i++){refreshStatue(p,i);if(state(p).revealed&(1<<i))continue;const n=api.spawnNpc({id:DRUIDS[i%2],x:SITES[i][4],y:SITES[i][5],z:0,wanderRadius:0,owner:p,ownerOnly:true});a.enter(n);a.cast.push(n);spirits.set(n,i);}
   scenery(p,SKELETON,4078,4441);scenery(p,TABLE,4076,4437);scenery(p,ENERGY_BRAZIER,4075,4445,22,1);
   if(state(p).placed!==255)scenery(p,DOOR,4072,4420,10,2);
  }sync(p);if(state(p).placed===255)openDoor(p);
 }
 function exit(e){if(visible(e)!==53637||stage(e.player)<760)return false;api.emitCustomEvent('wgs:return-chasm',{player:e.player});return true;}
 function skeleton(e) {
  const p = e.player;
  if (!sessions.has(p) || ![SKELETON, ...SKELETONS].includes(visible(e))) return false;
  // The remains hold the silver sickle (b) and a druid pouch with six charges. Both
  // need a free slot; a full bag keeps the search open so it can be retried, and a
  // player who carries no pouch is handed a fresh one.
  const needsSickle = !held(p, SICKLE);
  const needsPouch = !held(p, POUCH) && !held(p, EMPTY_POUCH);
  const neededSlots = Number(needsSickle) + Number(needsPouch);
  if (neededSlots > p.getInventory().getFreeSlots()) {
   const itemName = needsPouch ? 'druid pouch' : 'silver sickle';
   p.sendMessage(`You need a free inventory space to take the ${itemName}.`);
   return true;
  }
  if (needsSickle) p.getInventory().adds(SICKLE, 1);
  if (needsPouch) p.getInventory().adds(POUCH, POUCH_CHARGES);
  p.setAttribute(POUCHES_ATTRIBUTE, 1);
  sync(p);
  return true;
 }
 function find(e){const s=state(e.player),l=e.object.getLocation(),id=visible(e);return SITES.findIndex(([x,y],i)=>x===l.getX()&&y===l.getY()&&[RECIPES[s.types[i]][1],RECIPES[s.types[i]][1]+1].includes(id));}
 function inspect(e){
  const p=e.player;if(!sessions.has(p))return false;const id=visible(e);
  if(id===TABLE||TABLES.includes(id)){p.sendMessage('The table holds '+count(state(p).placed)+' of the eight dolmens.');return true;}
  if(id===ENERGY_BRAZIER){api.emitCustomEvent('potions:apply-stamina',{player:p});p.sendMessage('The brazier fills you with renewed energy.');return true;}
  const i=find(e);if(i<0)return false;const s=state(p),r=RECIPES[s.types[i]];
  p.sendMessage('The statue represents '+r[0]+'. '+r[3].map(ids=>ids.map(id=>api.core.ItemDefinition.forId(id).getName()).join(' + ')).join(' or '));
  if(s.finished&(1<<i))if(!(s.placed&(1<<i)))give(p,r[2]);return true;
 }
 function ingredients(e) {
  const p = e.player;
  const siteIndex = spirits.get(e.target);
  if (siteIndex === undefined || e.target.getOwner() !== p) return;
  if (e.itemId !== POUCH) {
   if (e.itemId === EMPTY_POUCH) {
    e.handled = true;
    p.sendMessage('You have nothing left in your druid pouch!');
   }
   return;
  }
  e.handled = true;
  const puzzle = state(p);
  if (puzzle.revealed & (1 << siteIndex)) {
   p.sendMessage('This druid spirit has already left its ingredients.');
   return;
  }
  if (!held(p, POUCH)) return;
  p.getInventory().deleteNumber(POUCH, 1);
  if (!held(p, POUCH)) p.getInventory().adds(EMPTY_POUCH, 1);
  puzzle.revealed |= 1 << siteIndex;
  store(p, puzzle);
  for (const id of RECIPES[puzzle.types[siteIndex]][3][0]) {
   drop(p, id, e.target.getLocation());
  }
  p.sendMessage('The druid spirit reveals the ingredients it carried.');
  api.removeNpc(e.target);
 }
 function openDoor(p){
  const a=sessions.get(p);if(!a||a.open)return;a.open=true;
  const o=ObjectManager.objectsAt(loc(4072,4420)).find(o=>o.getPrivateArea()===a&&o.getId()===DOOR);if(o)ObjectManager.deregister(o,true);
  p.getPacketSender().sendVarbit(10815,0);advance(p,800);p.sendMessage('The huge door opens.');
 }
 function use(e){
  const p=e.player;if(!sessions.has(p))return;const id=visible(e),s=state(p);
  if(id===TABLE||TABLES.includes(id)){
   const i=s.types.findIndex(n=>RECIPES[n][2]===e.itemId);if(i<0)return;e.handled=true;
   if(!(s.finished&(1<<i))||s.placed&(1<<i))return;p.getInventory().deleteNumber(e.itemId,1);s.placed|=1<<i;store(p,s);sync(p);if(s.placed===255)openDoor(p);return;
  }
  const i=find(e);if(i<0)return;const r=RECIPES[s.types[i]],slot=r[3].find(recipe=>recipe.includes(e.itemId))?.indexOf(e.itemId);e.handled=true;
  if(s.finished&(1<<i)){p.sendMessage('This statue is already complete.');return;}
  if(slot===undefined){p.sendMessage('This ingredient does not suit '+r[0]+'.');return;}
  const inserted=s.ingredients[i],previous=inserted[slot];p.getInventory().deleteNumber(e.itemId,1);if(previous)drop(p,previous,p.getLocation());inserted[slot]=e.itemId;
  if(r[3].some(recipe=>recipe.every((item,n)=>inserted[n]===item))){s.finished|=1<<i;s.ingredients[i]=[];give(p,r[2]);refreshStatue(p,i);}
  store(p,s);
 }
 function bloom(e){
  const p=e.player;if(e.itemId!==SICKLE||!String(e.option).toLowerCase().includes('bloom')||!sessions.has(p))return;e.handled=true;
  const skill=p.getSkillManager(),prayer=skill.getCurrentLevel(Skill.PRAYER);if(prayer<1){p.sendMessage('You need Prayer points to cast Bloom.');return;}
  const l=p.getLocation();api.core.RegionManager.loadMapFiles(l.getX(),l.getY());const plants=[];
  for(let x=l.getX()-2;x<=l.getX()+2;x++)for(let y=l.getY()-2;y<=l.getY()+2;y++)for(const o of MapObjects.mapObjects.get(MapObjects.getHash(x,y,0))||[])if(o.getId()===DEAD_VINE)plants.push(o);
  if(!plants.length){p.sendMessage('Stand near the dead vines to cast Bloom.');return;}
  skill.setCurrentLevel(Skill.PRAYER,Math.max(0,prayer-(1+Math.floor(Math.random()*6))),true);p.performAnimation(new Animation(902));
  for(const o of plants)replace(p,FLOWERING_VINE,[o.getLocation().getX(),o.getLocation().getY(),0],o.getType(),o.getFace());
 }
 function pick(e){const p=e.player;if(!sessions.has(p)||visible(e)!==FLOWERING_VINE)return false;if(!p.getInventory().getFreeSlots()){p.sendMessage('You need a free inventory space.');return true;}p.getInventory().adds(FLOWER,1);const l=e.object.getLocation();replace(p,DEAD_VINE,[l.getX(),l.getY(),0],e.object.getType(),e.object.getFace());return true;}
 function login({ player }) {
  sync(player);
  const location = player.getLocation();
  const inTemple = location.getX() >= 4032 && location.getX() <= 4159
   && location.getY() >= 4352 && location.getY() <= 4543;
  if (stage(player) < 900 && inTemple) player.moveTo(loc(3229, 9527, 2));
 }
 api.onCustomEvent('wgs:enter-temple',enter);
 api.onObjectInteraction('Skeleton',{Search:skeleton});
 api.onObjectInteraction('Hole',{'Crawl-through':exit});
 api.onObjectInteraction('Statue',{Inspect:inspect});
 api.onObjectInteraction('Stone table',{Inspect:inspect});
 api.onObjectInteraction('Brazier',{Inspect:inspect});
 api.onItemOnNpc(ingredients,{noted:false});
 api.onItemOnObject(use,{noted:false});
 api.onItemAction(bloom);
 api.onObjectInteraction('Vine flower',{Pick:pick});
 api.onPlayerLogin(login);
 return {RECIPES,SITES,state,inspect,use,ingredients,skeleton,pick,enter,sessions,spirits};
};

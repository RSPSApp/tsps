/** Wiki oil lamps and sapphire lanterns: assemble, distil fuel, light and extinguish. */
const OIL_ATTRIBUTE='oil-lights:distilled-oil';
const RIMMINGTON_STILL_LOCATION='2937,3210,0',RIMMINGTON_OIL_VARBIT=281;
let api;
let core;
let families,filled,lit,empty;
function refresh(p){p.getInventory().refreshItems();}
function light(e){
 const I=core.ItemIdentifiers,p=e.player,ids=[e.usedItemId,e.usedWithItemId];if(!ids.includes(I.TINDERBOX))return;
 const id=ids.find(id=>id!==I.TINDERBOX),f=filled.get(id);if(!f&&!empty.has(id))return;e.handled=true;
 if(!f){p.sendMessage('You need to fill the lantern with lamp oil first.');return;}
 if(p.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING)<f.level){p.sendMessage('You need '+f.level+' Firemaking to light this.');return;}
 const item=[e.usedItem,e.usedWithItem].find(i=>i?.getId()===id);if(!item||!p.getInventory().contains(I.TINDERBOX))return;
 item.setId(f.lit);refresh(p);p.performAnimation(new core.Animation(733));
 api.emitCustomEvent('oil-lights:lit',{player:p,itemId:f.lit});
}
function extinguish({player,item}){const f=lit.get(item.getId());if(!f)return false;item.setId(f.filled);refresh(player);return true;}
function syncOil({player}){player.getPacketSender().sendVarbit(RIMMINGTON_OIL_VARBIT,player.getAttribute(OIL_ATTRIBUTE)===RIMMINGTON_STILL_LOCATION?1:0);}
function fuel(e){
 const p=e.player,I=core.ItemIdentifiers,name=core.ObjectDefinition.forPlayer(e.objectId??e.object.getId(),p)?.getName();if(!['Lamp oil still','Lamp still'].includes(name))return;
 const f=empty.get(e.itemId);if(e.itemId!==I.SWAMP_TAR&&!f)return;e.handled=true;
 const l=e.object.getLocation(),still=l.getX()+','+l.getY()+','+l.getZ();
 if(e.itemId===I.SWAMP_TAR){if(p.getAttribute(OIL_ATTRIBUTE)===still){p.sendMessage('The still already contains lamp oil.');return;}if(!p.getInventory().contains(I.SWAMP_TAR))return;p.getInventory().deleteNumber(I.SWAMP_TAR,1);p.setAttribute(OIL_ATTRIBUTE,still);syncOil({player:p});p.sendMessage('You distil the swamp tar into lamp oil.');return;}
 if(p.getAttribute(OIL_ATTRIBUTE)!==still){p.sendMessage('Use swamp tar on the still to make lamp oil first.');return;}
 const item=p.getInventory().getItems().find(i=>i?.getId()===e.itemId);if(!item)return;
 item.setId(f.filled);p.setAttribute(OIL_ATTRIBUTE,0);syncOil({player:p});refresh(p);p.sendMessage('You fill the lantern with lamp oil.');
}
function lens(e){
 const p=e.player,I=core.ItemIdentifiers,ids=[e.usedItemId,e.usedWithItemId],sapphire=ids.includes(I.SAPPHIRE),glass=ids.includes(I.LANTERN_LENS);
 if(!sapphire&&!glass)return;const insert=sapphire?I.SAPPHIRE:I.LANTERN_LENS,id=ids.find(id=>id!==insert);
 const choices=sapphire?[[I.BULLSEYE_LANTERN_UNF_,I.SAPPHIRE_LANTERN,0],[I.BULLSEYE_LANTERN_EMPTY_,I.SAPPHIRE_LANTERN,I.LANTERN_LENS],[I.BULLSEYE_LANTERN,I.SAPPHIRE_LANTERN_2,I.LANTERN_LENS]]:[[I.BULLSEYE_LANTERN_UNF_,I.BULLSEYE_LANTERN_EMPTY_,0],[I.SAPPHIRE_LANTERN,I.BULLSEYE_LANTERN_EMPTY_,I.SAPPHIRE],[I.SAPPHIRE_LANTERN_2,I.BULLSEYE_LANTERN,I.SAPPHIRE]];
 const recipe=choices.find(r=>r[0]===id);if(!recipe)return;e.handled=true;
 const level=sapphire?20:49,manager=p.getSkillManager(),actual=id===I.BULLSEYE_LANTERN_UNF_?manager.getCurrentLevel(core.Skill.CRAFTING):manager.getMaxLevel(core.Skill.CRAFTING);
 if(actual<level){p.sendMessage('You need '+level+' Crafting to fit this lens.');return;}
 const item=[e.usedItem,e.usedWithItem].find(i=>i?.getId()===id);if(!item||!p.getInventory().contains(insert))return;
 p.getInventory().deleteNumber(insert,1);item.setId(recipe[1]);if(recipe[2])p.getInventory().adds(recipe[2],1);refresh(p);
}
function attach(pluginApi){
 api=pluginApi;core=api.core;const I=core.ItemIdentifiers;
 families=[{empty:I.EMPTY_OIL_LAMP,filled:I.OIL_LAMP,lit:I.OIL_LAMP_3,level:12},{empty:I.EMPTY_OIL_LANTERN,filled:I.OIL_LANTERN,lit:I.OIL_LANTERN_3,level:26},{empty:I.BULLSEYE_LANTERN_EMPTY_,filled:I.BULLSEYE_LANTERN,lit:I.BULLSEYE_LANTERN_3,level:49},{empty:I.SAPPHIRE_LANTERN,filled:I.SAPPHIRE_LANTERN_2,lit:I.SAPPHIRE_LANTERN_3,level:49}];
 empty=new Map(families.map(f=>[f.empty,f]));filled=new Map(families.map(f=>[f.filled,f]));lit=new Map(families.map(f=>[f.lit,f]));
 api.persistAttribute(OIL_ATTRIBUTE);api.onPlayerLogin(syncOil);
 api.onItemOnItem(light,{noted:false});api.onItemOnItem(lens,{noted:false});api.onItemOnObject(fuel,{noted:false});
 api.onItemAction('Oil lamp',{Extinguish:extinguish});api.onItemAction('Oil lantern',{Extinguish:extinguish});api.onItemAction('Bullseye lantern',{Extinguish:extinguish});api.onItemAction('Sapphire lantern',{Extinguish:extinguish});
}
module.exports={name:'OilLights',members:true,register(api){attach(api);}};

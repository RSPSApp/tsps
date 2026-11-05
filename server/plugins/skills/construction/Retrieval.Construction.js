"use strict";
const {HOUSE_ATTRIBUTE,DECORATIONS_ATTRIBUTE}=require("./StorageState.Construction");
const DECORATIONS=require("./data/holiday-decorations.json").decorations;
const COSTUME_CONTAINERS=new Set(["TOY_BOX","MAGIC_WARDROBE","ARMOUR_CASE","FANCY_DRESS_BOX","CAPE_RACK","TREASURE_CHEST"]);

/** External retrieval is still a transfer from the owner's actual house save, not a copy. */
function retrieve(api,request) {
  if (!request?.player || !Array.isArray(request.itemIds) || !request.itemIds.every(id=>Number.isInteger(id)&&id>0)) return;
  const {player}=request,house=player.getAttribute(HOUSE_ATTRIBUTE);
  if (!Array.isArray(house?.rooms)) return;
  const ids=new Set(request.itemIds),entries=[];
  for(const room of house.rooms.flat(2)) for(const furniture of Object.values(room?.furnitureByLocation??{})) {
    if (!COSTUME_CONTAINERS.has(furniture.hotspotKey)) continue;
    for(const [key,count] of Object.entries(furniture.storage??{})) if(ids.has(Number(key))&&Number.isSafeInteger(count)&&count>0) entries.push({furniture,id:Number(key),count});
  }
  request.count=entries.reduce((sum,entry)=>sum+entry.count,0);
  if(request.mode!=="retrieve" || !entries.length || !ids.has(request.outputId)) return;
  const item=new api.core.Item(request.outputId,1),inventory=player.getInventory();
  if(inventory.getAddableAmount(item)!==1) return;
  const before=inventory.getAmount(request.outputId);
  inventory.add(item,false);
  if(inventory.getAmount(request.outputId)!==before+1) return;
  const source=entries[0];
  if(--source.furniture.storage[source.id]===0)delete source.furniture.storage[source.id];
  player.setAttribute(HOUSE_ATTRIBUTE,house);
  request.taken=true;
  inventory.refreshItems();
}
/** "construction:planted" { player, itemIds }: holiday decorations planted in the house are still owned, like stored ones. */
function planted(api,request) {
  if(!request?.player||!Array.isArray(request.itemIds))return;
  const saved=request.player.getAttribute(DECORATIONS_ATTRIBUTE);
  if(!saved||typeof saved!=="object")return;
  for(const decoration of DECORATIONS)if(saved[decoration.key])request.itemIds.push(api.core.CacheDefinitions.getObjId(decoration.item));
}
module.exports={retrieve,planted};

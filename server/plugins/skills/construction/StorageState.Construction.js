"use strict";
// Shared persisted owner, also available when members-only house entry is disabled.
module.exports.HOUSE_ATTRIBUTE = "construction:house";
// Holiday decorations planted in the house (Decorations.Construction), by their data key.
module.exports.DECORATIONS_ATTRIBUTE = "construction:holiday-decorations";

function createDefaultHouseSave() {
  const rooms = Array.from({length:3},()=>Array.from({length:8},()=>Array(8).fill(null)));
  rooms[1][4][4] = {roomKey:"GARDEN",rotation:0,furniture:{CENTERPIECE:"EXIT_PORTAL"}};
  rooms[1][4][5] = {roomKey:"PARLOUR",rotation:0,furniture:{}};
  return {rooms};
}
function defaultHouse() {
  return {...createDefaultHouseSave(),owned:false,defaultBuildingMode:false};
}
Object.assign(module.exports,{createDefaultHouseSave,defaultHouse});

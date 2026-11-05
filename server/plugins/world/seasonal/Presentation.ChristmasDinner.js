"use strict";

const {camera}=require('./data/christmas-2025-scene.json');
const INSTANT_CAMERA=Object.freeze({rate:0,rate2:100,heightRelative:false});
// Pinned rev241 fade_overlay clientscript948 uses client cycles (50 per second).
// The guide shows a fade here, but does not establish Christmas-specific ticks.
const FADE_SCRIPT=948,FADE_CYCLES=50,FADE_TICKS=Math.ceil(FADE_CYCLES/30);
const reveals=new Map();

function ownsFade(record){
  return !!record.fade&&record.player.getPacketSender().getSubInterfaceAt(record.fade.targetUid)===record.fade;
}
function fadeOut(api,record){
  const sender=record.player.getPacketSender(),target=api.core.CacheDefinitions.getComponentId('toplevel_osrs_stretch:overlay_atmosphere');
  if(sender.getSubInterfaceAt(target))return false;
  record.fade=sender.mountSubInterface(target,api.core.CacheDefinitions.getInterfaceId('fade_overlay'),1,
    {postScripts:[{scriptId:FADE_SCRIPT,args:[0,255,0,0,FADE_CYCLES]}]});
  return ownsFade(record);
}
function closeFade(record){
  if(record.fade)record.player.getPacketSender().closeSubInterfaceMount(record.fade);
  record.fade=undefined;
}
function cancel(api,{player},expected){
  const reveal=reveals.get(player);
  if(!reveal||(expected&&expected!==reveal))return;
  reveals.delete(player);api.core.TaskManager.cancelTasks(reveal);closeFade(reveal);
}
function cancelAll(api){for(const player of [...reveals.keys()])cancel(api,{player});}
function reveal(api,record){
  if(!ownsFade(record)){closeFade(record);return;}
  cancel(api,record);
  const pending={player:record.player,fade:record.fade};record.fade=undefined;
  reveals.set(pending.player,pending);
  pending.player.getPacketSender().sendInterfaceScript(FADE_SCRIPT,[0,0,0,255,FADE_CYCLES]);
  class RevealTask extends api.core.Task{
    constructor(){super(FADE_TICKS,pending);}
    execute(){cancel(api,pending,pending);}
  }
  api.core.TaskManager.submit(new RevealTask());
}

function start(api,record){
  const sender=record.player.getPacketSender(),status=api.core.CacheDefinitions.getVarbitId('cutscene_status');
  record.cutsceneStatus=sender.getVarbit(status);
  record.fovClamp=sender.getVarbit(api.core.CacheDefinitions.getVarbitId('fov_clamp'));
  record.cameraStarted=true;
  // The native toplevel redraw reads this varbit; keep its ordinary layout
  // owner instead of individually hiding/chatbox/minimap/sidebar components.
  sender.sendVarbit(status,1);
  // Native toplevel_resize fixes the scene FOV and effective viewport for this
  // mode, instead of magnifying a shot with the player's ordinary zoom/aspect.
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('fov_clamp'),1);
  sender.sendCameraMoveTo(...camera.bar.from,INSTANT_CAMERA);
  sender.sendCameraLookAt(...camera.bar.at,INSTANT_CAMERA);
}
function delivery(api,record){
  const sender=record.player.getPacketSender(),shot=camera.delivery[record.table<2?'north':'south'];
  sender.sendCameraMoveTo(...shot.from,INSTANT_CAMERA);
  sender.sendCameraLookAt(...shot.at,INSTANT_CAMERA);
}
function clear(api,record){
  // Called while the player still belongs to this scene, before a foreign
  // Area.enter gets its postEnter and can establish its own camera/layout.
  if(!record.cameraStarted)return;
  const sender=record.player.getPacketSender();
  sender.sendCameraReset();
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('cutscene_status'),record.cutsceneStatus);
  sender.sendVarbit(api.core.CacheDefinitions.getVarbitId('fov_clamp'),record.fovClamp);
  record.cameraStarted=false;
}

module.exports={start,delivery,clear,fadeOut,ownsFade,closeFade,reveal,cancel,cancelAll,FADE_TICKS};

"use strict";
const {QuestHelperRuntime}=require('./questhelper/Runtime.QuestHelper');
const {QuestHelperHttp}=require('./questhelper/Http.QuestHelper');
const {getRegisteredQuests}=require('./QuestRuntime');
let runtime;
function receive(event){if(event.channel!=='quest-helper')return;event.handled=true;void runtime.receive(event.player,event.data);}
function logout({player}){void runtime.close(player);}
function shutdown(){return runtime.shutdown();}
module.exports=function attach(api){
 runtime=new QuestHelperRuntime({getQuests:getRegisteredQuests,bridge:new QuestHelperHttp(),send:(player,data)=>player.getSession().sendClientPacket(api.core.encodePluginMessage('quest-helper',data))});
 api.onCustomEvent('network:plugin-message',receive);
 api.onPlayerLogout(logout);api.onPlayerDisconnect(logout);api.onServerShutdown(shutdown);
};

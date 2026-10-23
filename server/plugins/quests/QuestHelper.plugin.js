"use strict";
const {QuestHelperRuntime}=require('./questhelper/Runtime.QuestHelper');
const {QuestHelperHttp}=require('./questhelper/Http.QuestHelper');
const {getRegisteredQuests}=require('./QuestRuntime');
const {createRfdRenderer,completionProjection}=require('./questhelper/RecipeForDisaster.QuestHelper');
const {createEligibility}=require('./questhelper/Recommendations.QuestHelper');
let runtime;
function receive(event){if(event.channel!=='quest-helper')return;event.handled=true;void runtime.receive(event.player,event.data);}
function logout({player}){void runtime.close(player);}
function shutdown(){return runtime.shutdown();}
function register(api){
 const rfd=createRfdRenderer({core:api.core,getQuests:getRegisteredQuests});
 runtime=new QuestHelperRuntime({getQuests:getRegisteredQuests,bridge:new QuestHelperHttp(),
  eligibility:createEligibility({cache:api.core.CacheDefinitions,Skill:api.core.Skill,getQuests:getRegisteredQuests}),
  nativeResult:(request,player)=>request.questKey==='recipe_for_disaster'?rfd(request,player):null,
  projectState:player=>({varbits:completionProjection(player)}),
  varbitDefinition:id=>api.core.CacheDefinitions.getVarbit(id),
  send:(player,data)=>player.getSession().sendClientPacket(api.core.encodePluginMessage('quest-helper',data))});
 api.onCustomEvent('network:plugin-message',receive);
 api.onPlayerLogout(logout);api.onPlayerDisconnect(logout);api.onServerShutdown(shutdown);
}
module.exports={name:'OfflineQuestHelper',register};

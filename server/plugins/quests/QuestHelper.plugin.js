"use strict";
const {QuestHelperRuntime}=require('./questhelper/Runtime.QuestHelper');
const {QuestHelperHttp}=require('./questhelper/Http.QuestHelper');
const {QuestHelperLauncher}=require('./questhelper/Launcher.QuestHelper');
const {getRegisteredQuests}=require('./QuestRuntime');
const {createRfdRenderer,completionProjection}=require('./questhelper/RecipeForDisaster.QuestHelper');
const {createEligibility}=require('./questhelper/Recommendations.QuestHelper');
const {contractState}=require('./questhelper/Contract.QuestHelper');
const {fillRequested}=require('./questhelper/Requests.QuestHelper');
let runtime,pluginApi;
// Starts a built bridge itself when no QUEST_HELPER_TOKEN/URL is configured.
const launcher=new QuestHelperLauncher();
function tutorialAvailable(){const query={available:false};pluginApi.emitCustomEvent('tutorial:availability',query);return query.available===true;}
function receive(event){if(event.channel!=='quest-helper')return;event.handled=true;void runtime.receive(event.player,event.data);}
function logout({player}){void runtime.closePlayer(player);}
function startBridge(){void launcher.start();}
// Sessions close first, while the bridge they belong to is still up.
function stopBridge(){launcher.stop();}
function shutdown(){return runtime.shutdown().finally(stopBridge);}
// The agent MCP drives this runtime headless; null until the plugin has registered.
function getRuntime(){return runtime??null;}
/**
 * The state a headless snapshot adds to the quests' registered vars: Recipe for Disaster's completion
 * bits, and what quests answer on "quest-helper:project-state" { player, varps, varbits } (their own
 * live varps and varbits that the guide reads).
 */
function projectState(player){
 const request={player,varps:{},varbits:{...completionProjection(player)}};
 pluginApi.emitCustomEvent('quest-helper:project-state',request);
 return {varps:request.varps,varbits:request.varbits};
}
function register(api){
 pluginApi=api;
 const rfd=createRfdRenderer({core:api.core,getQuests:getRegisteredQuests});
 runtime=new QuestHelperRuntime({getQuests:getRegisteredQuests,bridge:new QuestHelperHttp({launcher}),
  eligibility:createEligibility({cache:api.core.CacheDefinitions,Skill:api.core.Skill,getQuests:getRegisteredQuests,tutorialAvailable}),
  contract:(name,wire,complete)=>contractState(api.core.CacheDefinitions,name,wire,complete),
  // The bridge's MISSING_STATE requests, answered from the player's own varps and the cache.
  fillRequests:(player,requests,snapshot)=>fillRequested(snapshot,requests,{
   varbit:id=>{const value=player.getPacketSender?.()?.getVarbit?.(id);return typeof value==='number'?value:Number.NaN;},
   definition:id=>api.core.CacheDefinitions.getVarbit(id),
  }),
  nativeResult:(request,player)=>request.questKey==='recipe_for_disaster'?rfd(request,player):null,
  projectState:projectState,
  varbitDefinition:id=>api.core.CacheDefinitions.getVarbit(id),
  send:(player,data)=>player.getSession().sendClientPacket(api.core.encodePluginMessage('quest-helper',data))});
 api.onCustomEvent('network:plugin-message',receive);
 api.onPlayerLogout(logout);api.onPlayerDisconnect(logout);api.onServerStartup(startBridge);api.onServerShutdown(shutdown);
}
module.exports={name:'OfflineQuestHelper',description:'Runs the offline Quest Helper, answering the client\'s quest-helper plugin messages from the player\'s varps and the cache.',register,getRuntime};

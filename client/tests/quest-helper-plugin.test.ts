import { strict as assert } from "node:assert";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { GameTick, PluginMessage, GameStateChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { QuestHelperPlugin } from "../game/plugins/questhelper/QuestHelperPlugin";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { Inventory } from "../rs/inventory/Inventory";
import { state as network } from "../network/serverConnection/state";
import { parsePluginMessage } from "../common/network/PluginMessage";
async function main(){
    Object.assign(globalThis,{WebSocket:{OPEN:1}}); const requests:any[]=[];
    network.socket={readyState:1,send:(bytes:Uint8Array)=>requests.push(parsePluginMessage(bytes.subarray(3)).data)} as any;
    network.lastSkillsState={combatLevel:3,totalLevel:1,byId:new Map([[0,{id:0,baseLevel:1,currentLevel:1,xp:0,boost:0,virtualLevel:1}]])};
    const bus=new EventBus(),config=new ConfigManager(bus),manager=new PluginManager(bus,config);
    const player:any={getIndexForServerId:()=>0,getLevel:()=>0,getAnimActionSeqId:()=>-1,getAnimMovementSeqId:()=>-1,getRotation:()=>0,getInteractionIndex:()=>-1};
    const client:any={stateMachine:{getState:()=>30},localPlayerName:"A",getControlledPlayerMovementTile:()=>({tileX:3200,tileY:3200}),controlledPlayerServerId:1,playerEcs:player,tileHighlightManager:new TileHighlightManager(),varManager:{values:new Int32Array(1),customVarbits:new Map(),varbitLoader:{load:()=>undefined},varpChangeListeners:new Set()},inventory:new Inventory(),equipment:new Inventory(14),bankInventory:new Inventory(1410),npcEcs:{forEachActive:()=>{},mutationListeners:new Set()},renderer:{getLocIdsAtTileAllLevels:()=>[],canvas:{width:765,height:503}},groundItems:{getAllStacks:()=>[],mutationListeners:new Set()},widgetManager:{rootInterface:-1,interfaceParents:new Map(),getAllGroupRoots:()=>[],groupLoadedListeners:new Set(),interfaceClosedListeners:new Set()}};
    manager.getInjector().provide(CLIENT_TOKEN,client);manager.loadCorePlugins([QuestHelperPlugin]); const plugin=manager.getPlugin(QuestHelperPlugin)!;
    assert.equal(manager.isEnabled(QuestHelperPlugin),false);bus.post(new GameTick());assert.equal(requests.length,0);
    await manager.setPluginEnabled(QuestHelperPlugin,true);assert.equal(manager.getInjector().get<ClientToolbar>(ClientToolbar).getNavigations().length,1);
    plugin.selectQuest("cook");bus.post(new GameTick());const request=requests.find(x=>x.type==="evaluate");assert.ok(request);assert.equal(request.snapshot.bank,undefined,"unknown bank must be omitted");
    const response={type:"result",protocol:1,session:request.session,sequence:request.sequence,questKey:"cook",sourceCommit:"abc",status:"active",activeStep:{id:"talk",text:["Talk"],targets:[{kind:"tile",x:3200,y:3200,plane:0}],requirements:[],dialogueChoices:[],widgets:[],overlays:[]},panels:[],diagnostics:[]};
    bus.post(new PluginMessage("quest-helper",response));assert.equal(plugin.getState().result?.status,"active");assert.equal(client.tileHighlightManager.getRenderEntries().length,1);
    const nativeNow=Date.now;Date.now=()=>nativeNow()+2000;for(const listener of client.groundItems.mutationListeners)listener({kind:"quantity",oldQuantity:3,stack:{itemId:1944,quantity:2,tile:{x:3200,y:3200,level:0}}});bus.post(new GameTick());Date.now=nativeNow;assert.equal(requests.filter(x=>x.type==="evaluate").at(-1).events.find((event:any)=>event.type==="itemQuantityChanged").oldQuantity,3);
    plugin.selectQuest("sheep");assert.equal(client.tileHighlightManager.getRenderEntries().length,0);bus.post(new PluginMessage("quest-helper",response));assert.equal(plugin.getState().result,null);
    assert.equal(config.getConfiguration("questhelper","selectedQuest"),"sheep");
    bus.post(new GameStateChanged(GameState.LOGIN_SCREEN));assert.equal(client.varManager.varpChangeListeners.size,0);assert.equal(plugin.getState().result,null);
    client.localPlayerName="B";bus.post(new GameTick());const current=requests.filter(x=>x.type==="evaluate").at(-1);assert.notEqual(current.session,request.session);bus.post(new PluginMessage("quest-helper",response));assert.equal(plugin.getState().result,null);
    await manager.setPluginEnabled(QuestHelperPlugin,false);assert.equal(manager.getInjector().get<ClientToolbar>(ClientToolbar).getNavigations().length,0);assert.equal(client.varManager.varpChangeListeners.size,0);assert.equal(client.tileHighlightManager.getRenderEntries().length,0);
    network.socket=null as any;network.lastSkillsState=undefined;console.log("quest helper native lifecycle, preference and network isolation passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});


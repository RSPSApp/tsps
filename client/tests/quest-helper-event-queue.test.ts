import { strict as assert } from "node:assert";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { GameTick } from "@runelite/api/events";
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
    manager.getInjector().provide(CLIENT_TOKEN,client);manager.loadCorePlugins([QuestHelperPlugin]);const plugin=manager.getPlugin(QuestHelperPlugin)!;
    await manager.setPluginEnabled(QuestHelperPlugin,true);
    // No quest selected: source events keep arriving, but nothing is evaluated or sent.
    let now=1_000_000;const realNow=Date.now;Date.now=()=>now;
    for(let t=0;t<25;t++){
        now+=1200;bus.post(new GameTick());
        for(let i=0;i<100;i++)for(const listener of client.varManager.varpChangeListeners)(listener as any)(1,0,i);
    }
    const catalogsBefore=requests.filter(r=>r.type==="catalog").length;
    for(let t=0;t<30;t++){now+=1200;bus.post(new GameTick());}
    const catalogsAfter=requests.filter(r=>r.type==="catalog").length;
    Date.now=realNow;
    assert.ok(!/overflow/.test(plugin.getState().status),"event queue must not overflow while no quest is selected: "+plugin.getState().status);
    assert.ok(catalogsAfter-catalogsBefore>0,"catalog polling must continue with no quest selected");
    await manager.setPluginEnabled(QuestHelperPlugin,false);
    network.socket=null as any;network.lastSkillsState=undefined;console.log("quest helper event queue stays bounded without a selection passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});

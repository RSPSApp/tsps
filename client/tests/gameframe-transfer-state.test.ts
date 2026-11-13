const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Exercise the production root consumer with real wire packets, cache widgets and CS2.
const project = path.resolve(__dirname, '../..');
const ts = require('typescript');
const {createCacheVm} = require(path.join(project,'client/scripts/cache/cs2-sweep.ts'));
const {loadGameframePaneRedirect, STANDARD_GAMEFRAME_ROOT} = require(path.join(project,'client/game/widgets/gameframePanes.ts'));
const {encodeWidgetSetRoot} = require(path.join(project,'server/src/main/typescript/elvarg/net/protocol/ClientProtocol.ts'));
const {decodeServerPacket} = require(path.join(project,'client/network/packet/ServerBinaryDecoder.ts'));
const sourceText = fs.readFileSync(path.join(project,'client/game/OsrsClient.ts'),'utf8');
const source = ts.createSourceFile('OsrsClient.ts',sourceText,ts.ScriptTarget.Latest,true);
let rootBlock, methods=[];
const names = new Set(['mapGameframeTargetUid','getGameframePaneRedirect','mountSubInterface']);
function visit(n) {
 if(ts.isIfStatement(n) && n.expression.getText(source) === 'payload?.action === "set_root"') rootBlock = n.thenStatement.getText(source);
 if(ts.isMethodDeclaration(n) && names.has(n.name.getText(source))) methods.push(n.getText(source));
 ts.forEachChild(n,visit);
}
visit(source); assert.ok(rootBlock); assert.equal(methods.length,3);
const compile = code => ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const prototypes = new Function('STANDARD_GAMEFRAME_ROOT','loadGameframePaneRedirect','markWidgetsLoaded',compile('class Methods {'+methods.join('\n')+'}; return Methods.prototype;'))(STANDARD_GAMEFRAME_ROOT,loadGameframePaneRedirect,()=>{});
const applyRoot = new Function('VARBIT_POPOUT_OPEN','VARBIT_POPOUT_PANEL_DESKTOP_DISABLED','markWidgetsLoaded',compile('return function(payload) '+rootBlock))(13090,13982,()=>{});
const {vm} = createCacheVm(); const wm=vm.context.widgetManager;
wm.resize(1000,700);
wm.onLoadListener=(_id,w)=>{vm.runScriptEvent({args:w.onLoad,widget:w});assert.equal(vm.lastError,null);};
wm.setRootInterface(548);
let opens=0, hiddenReplay=0, transmits=[], invalidations=0;
const client=Object.assign(Object.create(prototypes), {
 widgetManager:wm, varManager:vm.context.varManager,cs2Vm:vm,
 gameframePaneRedirects:new Map(),loaderFactory:{getEnumTypeLoader:()=>vm.context.enumTypeLoader},
 serverSubInterfaces:new Map(),widgetInputController:{invalidateHoverCache(){invalidations++;}},
 triggerInitialVarTransmitForGroup:g=>transmits.push(g),customInterfaces:{onInterfaceOpened(){opens++;}},
 isCloseOnOutsideClickTarget:()=>true,runWidgetScopedClientScript(){hiddenReplay++;},
});
function open(standard, group, type=1) {
 client.mountSubInterface({targetUid:standard,groupId:group,type,hiddenUids:[],postScripts:[{scriptId:123,args:[]}]});
}
open((161<<16)|16,12,0);open((161<<16)|96,162);open((162<<16)|567,231,0);
const items=wm.getWidgetByUid((12<<16)|12), slot=items.children[0], bankMount=wm.getSubInterface((548<<16)|41);
const nested=wm.getSubInterface((162<<16)|567); const dialogue=wm.getWidgetByUid((231<<16)|6);
dialogue.text='Same dialogue page';items.scrollY=50;slot.text='Retained slot state';slot.lastChangedInvCount=75;
// Exact production cached open payload would otherwise overwrite this later visibility.
const bankPayload=client.serverSubInterfaces.get((161<<16)|16).payload;
bankPayload.hiddenUids=[items.uid];items.hidden=items.isHidden=false;
let falseClose=[];wm.interfaceClosedListeners.add(g=>falseClose.push(g));
const initialOpens=opens,initialReplays=hiddenReplay;
const run = root=>applyRoot.call(client,decodeServerPacket(encodeWidgetSetRoot(root)).payload);
for (const root of [161,164,548,161,601,161,161]) {
 run(root);
 assert.equal(wm.getWidgetByUid(items.uid).children[0],slot);
 assert.equal(wm.getSubInterface(wm.getInterfaceParentContainerUid(12)),bankMount);
 assert.equal(wm.getSubInterface((162<<16)|567),nested);
 assert.equal(dialogue.text,'Same dialogue page');
 assert.equal(items.scrollY,50);assert.equal(slot.lastChangedInvCount,75);
 assert.equal(items.hidden,false); assert.equal(items.isHidden,false);
}
assert.equal(opens,initialOpens);assert.equal(hiddenReplay,initialReplays);
assert.deepEqual(falseClose.filter(g=>[12,162,231].includes(g)),[]);
assert.equal(invalidations,7);
assert.deepEqual(transmits,[12,162,231,161,164,548,161,601,161,161]);
console.log('PASS production decoded roots548→161→164→548→161→601→161→161 preserve bank child/mount, nested dialogue, visibility, cursor, no open/postscript replay');
// A real pane with no fixed-layout destination retains the existing close/reopen policy.


// The unchanged skipped-pane policy closes modern-only viewport-tracker content in fixed mode.
open((161<<16)|92,155,0);
const skipped=wm.getSubInterface((161<<16)|92);
assert.ok(skipped);
// A mount nested inside the skipped pane goes with it: closed with a notice, not left mounted out of sight.
const host=[...wm.getGroup(155).widgetsByUid.values()].find(w=>w.type===0&&w.uid!==((155<<16)|0));
assert.ok(host,'PRE: 155 has a layer to mount into');
open(host.uid,229,1);
assert.equal(wm.getSubInterface(host.uid)?.group,229,'PRE: 229 mounted inside 155');
run(548);
assert.equal(wm.getInterfaceParentContainerUid(155),undefined);
assert.ok(falseClose.includes(155));
assert.equal(wm.getInterfaceParentContainerUid(229),undefined,'the nested mount closes with its pane');
assert.ok(falseClose.includes(229),'and the close is announced');
assert.equal(wm.getWidgetByUid(items.uid).children[0],slot,'unrelated bank preserved while skipped pane closes');
run(161);
assert.equal(wm.getSubInterface((161<<16)|92).group,155);
assert.notEqual(wm.getSubInterface((161<<16)|92),skipped,'reappearing skipped pane is a real initialization under current policy');
assert.equal(wm.getSubInterface(host.uid)?.group,229,'the nested mount comes back with its pane');
assert.equal(wm.getWidgetByUid(items.uid).children[0],slot);
console.log('PASS skipped modern-only pane closes/reopens and preserves unrelated bank; this intentionally retains pre-existing skipped-pane lifecycle');
const {WidgetInputController}=require(path.join(project,'client/game/widgets/WidgetInputController.ts'));
client.widgetInputController=new WidgetInputController({});
client.widgetInputController.state.cachedHoverHits=[{uid:items.uid}];
const beforeWelcomeOpens=opens;
run(378);
assert.equal(wm.rootInterface,378);
assert.equal(client.widgetInputController.state.cachedHoverHits,null);
assert.ok(opens>beforeWelcomeOpens,'welcome transition remains real open replay');
const beforePlayOpens=opens;
run(161);
assert.equal(wm.rootInterface,161);
assert.ok(opens>beforePlayOpens,'Play bootstrap remains initialized normally');
assert.equal(wm.getSubInterface((161<<16)|16).group,12);
console.log('PASS welcome378→Play161 retains existing real-open policy and actual WidgetInputController invalidation');

const reopenedItems = wm.getWidgetByUid(items.uid), beforeClose = reopenedItems.children[0];
wm.closeSubInterface(wm.getInterfaceParentContainerUid(12));
assert.equal(wm.isGroupLoaded(12), false);
open((161<<16)|16,12,0);
assert.notEqual(wm.getWidgetByUid(items.uid).children[0], beforeClose, 'a real close/reopen still initializes fresh children');

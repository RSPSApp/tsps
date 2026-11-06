// Discovered by client yarn test; directly run with yarn tsx tests/player-transform-chathead.test.ts.
// Requires the named revision 241 native cache and its models in server/caches.
// Whole production AST seams avoid unrelated UI/bootstrap imports; changes to those
// declarations or cache revision/head models require updating and reviewing this fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import * as protocol from '../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol';
import { DialogueExpression } from '../../server/src/main/typescript/elvarg/game/model/dialogues/DialogueExpression';
import { decodeServerPacket } from '../network/packet/ServerBinaryDecoder';
import { decodeAppearanceBinary } from '../game/sync/AppearanceDecoder';
import { PlayerAppearance } from '../rs/config/player/PlayerAppearance';
import { PlayerEcs } from '../game/ecs/PlayerEcs';
import { CacheSystem } from '../rs/cache/CacheSystem';
import { getCacheLoaderFactory } from '../rs/cache/loader/CacheLoaderFactory';
import { loadCache, loadCacheInfos } from '../scripts/cache/load-util';
import { WidgetLoader } from '../widgets/WidgetLoader';
import { PendingInterfaceUpdates } from '../widgets/custom/PendingInterfaceUpdates';
import { HeldWidgetProperties } from '../widgets/HeldWidgetProperties';
import { ChatheadFactory } from '../render/ChatheadFactory';
import { PlayerChatheadFactory } from '../render/PlayerChatheadFactory';
import { NpcType } from '../rs/config/npctype/NpcType';
import { VarManager } from '../rs/config/vartype/VarManager';
import { InputManager } from '../game/InputManager';

const read = (relative: string) => ts.createSourceFile(relative,
    fs.readFileSync(path.resolve(__dirname, relative), 'utf8'), ts.ScriptTarget.Latest, true);
function findOne(source: ts.SourceFile, select: (node: ts.Node) => string | undefined) {
    const found: string[] = [];
    const visit = (node: ts.Node) => { const text = select(node); if (text) found.push(text); ts.forEachChild(node, visit); };
    visit(source);
    assert.equal(found.length, 1, 'exactly one complete production seam');
    return found[0];
}
const compile = (code: string) => ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
// Preserve the complete real dialogue producer and wrapping method without loading
// unrelated Misc directory-discovery code and its computed package require.
const miscSource = read('../../server/src/main/typescript/elvarg/util/Misc.ts');
const wrapMethod = findOne(miscSource, n => ts.isMethodDeclaration(n) &&
    n.name.getText(miscSource) === 'wrapText' ? n.getText(miscSource).replace(/^public /, '') : undefined);
const MiscText = new Function(compile('class MiscText {' + wrapMethod + '} return MiscText;'))();
const dialogueSource = read('../../server/src/main/typescript/elvarg/game/model/dialogues/entries/Dialogue.ts');
const dialogueClass = findOne(dialogueSource, n => ts.isClassDeclaration(n) && n.name?.text === 'Dialogue'
    ? n.getText(dialogueSource).replace(/^export /, '') : undefined);
const playerDialogueSource = read('../../server/src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue.ts');
const playerDialogueClass = findOne(playerDialogueSource, n => ts.isClassDeclaration(n) && n.name?.text === 'PlayerDialogue'
    ? n.getText(playerDialogueSource).replace(/^export /, '') : undefined);
const PlayerDialogue = new Function('Misc', 'DialogueExpression', compile(dialogueClass + '\n' +
    playerDialogueClass + '\nreturn PlayerDialogue;'))(MiscText, DialogueExpression);
const clientSource = read('../game/OsrsClient.ts');
const widgetCallback = findOne(clientSource, n => ts.isVariableDeclaration(n) &&
    n.name.getText(clientSource) === 'handleWidgetPayload' ? n.initializer!.getText(clientSource) : undefined);
const method = (name: string) => findOne(clientSource, n => ts.isMethodDeclaration(n) &&
    n.name.getText(clientSource) === name ? n.getText(clientSource).replace(/^private /, '') : undefined);
const Receiver = new Function('PlayerAppearance', 'HELD_WIDGET_ACTIONS', compile('class Receiver {' +
    method('buildPlayerAppearanceFromPayload') + method('holdForUnloadedGroup') + '} return Receiver;'))(
    PlayerAppearance, new Set(['set_player_head']));
// Keep native widget decoding and the exact production lookup methods, without
// constructing the mobile/layout/timer UI manager outside this head-model scope.
const managerSource = read('../widgets/WidgetManager.ts');
const lookupMethods = ['getWidgetByUid', 'isGroupLoaded'].map(name => findOne(managerSource,
    n => ts.isMethodDeclaration(n) && n.name.getText(managerSource) === name
        ? n.getText(managerSource) : undefined)).join('\n');
const HeadWidgetLookup = new Function(compile('class HeadWidgetLookup {' + lookupMethods +
    '} return HeadWidgetLookup;'))();
const overlaySource = read('../widgets/gl/widgetsOverlayFactory.ts');
const modelCallback = findOne(overlaySource, n => ts.isPropertyAssignment(n) &&
    n.name.getText(overlaySource) === 'getRenderModelCanvas' ? n.initializer.getText(overlaySource) : undefined);
const senderSource = read('../../server/src/main/typescript/elvarg/net/packet/PacketSender.ts');
const headMethod = findOne(senderSource, n => ts.isMethodDeclaration(n) &&
    n.name.getText(senderSource) === 'sendPlayerHeadOnInterface' ? n.getText(senderSource).replace(/^public /, '') : undefined);
const scriptMethod = findOne(senderSource, n => ts.isMethodDeclaration(n) &&
    n.name.getText(senderSource) === 'sendClientScript' ? n.getText(senderSource) : undefined);
const HeadSender = new Function('encodeWidgetSetPlayerHead', 'encodeRunClientScript',
    compile('class Sender {' + headMethod + scriptMethod + '} return Sender;'))(
        protocol.encodeWidgetSetPlayerHead, protocol.encodeRunClientScript);
const fingerprint = (m: any) => {
    assert.ok(m && m.verticesCount > 0 && m.faceCount > 0, 'native model prerequisites');
    return createHash('sha256').update(JSON.stringify([
        m.verticesCount, m.faceCount, ...['verticesX','verticesY','verticesZ','indices1','indices2','indices3',
        'faceColors1','faceColors2','faceColors3','faceTextures'].map(k => m[k] ? Array.from(m[k]) : null),
    ])).digest('hex');
};

test('native dialogue head uses transformed NPC geometry and restores player appearance', async () => {
    const globals = ['window', 'document'] as const;
    const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    let ecsForCleanup: PlayerEcs | undefined;
    try {
    const infos = loadCacheInfos();
    const info = infos.find(i => i.name === 'osrs-241_2026-10-20');
    assert.ok(info, 'the explicitly named active-cache version is available');
    assert.equal(info.revision, 241);
    const loaded = loadCache(info);
    const cache = CacheSystem.fromFiles(info, loaded.files);
    const loaders: any = getCacheLoaderFactory(info, cache);
    const modelLoader = loaders.getModelLoader(), textureLoader = loaders.getTextureLoader();
    const idkTypeLoader = loaders.getIdkTypeLoader(), objTypeLoader = loaders.getObjTypeLoader();
    const npcTypeLoader = loaders.getNpcTypeLoader();
    const group = new WidgetLoader(cache).loadWidgetGroup(217);
    assert.ok(group && group.widgets.size > 0, 'native cache group217 decoded');
    const invalidated: number[] = [];
    const wm = Object.assign(new HeadWidgetLookup(), { widgetByUid: group.widgets,
        loadedGroups: { 217: true },
        // Raster invalidation is outside this model-selection test; observe the notification.
        invalidateWidgetRender(w: any) { invalidated.push(w.uid); },
    });
    const uid = (217 << 16) | 2;
    const widget = wm.getWidgetByUid(uid)!;
    assert.ok(widget, 'real dialogue head widget loaded');
    const ecs = new PlayerEcs();
    ecsForCleanup = ecs;
    const index = ecs.allocatePlayer(1);
    const client: any = Object.assign(new Receiver(), { widgetManager: wm, playerEcs: ecs,
        controlledPlayerServerId: 1, pendingInterfaceUpdates: new PendingInterfaceUpdates(),
        heldWidgetProperties: new HeldWidgetProperties() });
    const handle = new Function(compile('return ' + widgetCallback)).call(client);
    const npcFactory = new ChatheadFactory(modelLoader, textureLoader);
    const playerFactory = new PlayerChatheadFactory(modelLoader, textureLoader, idkTypeLoader, objTypeLoader);
    // Only the final GPU/canvas sink is replaced; both selected model factories are real.
    const host: any = { osrsClient: { ...client, modelLoader, textureLoader, idkTypeLoader,
        objTypeLoader, npcTypeLoader }, model2DRenderer: {
            renderModelInstanceToCanvasExtents: (model: any) => model,
        } };
    const render = new Function('host','PlayerChatheadFactory','ChatheadFactory',
        compile('return (' + modelCallback + ')();'))(host, PlayerChatheadFactory, ChatheadFactory);
    const sent: Uint8Array[] = [];
    const sender: any = Object.assign(new HeadSender(), { player: { getSession: () => ({
        sendClientPacket: (p: Uint8Array) => sent.push(p),
    }) }, sendChatboxInterface(group: number) { assert.equal(group,217); return this; },
    sendInterfaceAnimation() { return this; }, sendString() { return this; },
    sendInterfaceFlagsRange() { return this; } });
    const dialoguePlayer: any = { getPacketSender: () => sender, getDisplayName: () => 'Protocol2410' };
    const normal = PlayerAppearance.defaultMale(idkTypeLoader);
    const failures: string[] = [], rows: any[] = [];
    function step(label: string, transform: number, colors = [0,0,0,0,0]) {
        const wire = protocol.encodePlayerAppearance({ gender: normal.gender, colors,
            kits: normal.kits, equip: normal.equip, npcTransformationId: transform },
            'Protocol2410', 3, 0, new Array(7).fill(-1));
        const decoded = decodeAppearanceBinary(wire)!;
        assert.ok(decoded, 'genuine encoded appearance decodes');
        assert.equal(decoded.npcTransformationId, transform);
        const appearance = client.buildPlayerAppearanceFromPayload({ ...decoded, equip: decoded.equipment });
        ecs.setAppearance(index, appearance);
        assert.equal(ecs.getAppearance(index)?.npcTransformationId, transform);
        sent.length = 0;
        PlayerDialogue.send(dialoguePlayer, "'obby-lobby' - what?", 588);
        const messages = sent.map(p => decodeServerPacket(p) as any);
        const heads = messages.filter(m => m?.type === 'widget' && m.payload?.action === 'set_player_head');
        assert.equal(heads.length, 1, 'real PlayerDialogue -> production PacketSender emits one head packet');
        assert.equal(sent.length, 2, 'dialogue also emits its real text-alignment script packet');
        const message: any = heads[0];
        assert.equal(message.type, 'widget');
        assert.equal(message.payload.action, 'set_player_head');
        assert.equal(message.payload.uid, uid);
        handle(message.payload);
        assert.equal(invalidated.at(-1), uid, 'production receiver invalidates actual cache widget');
        const actual = render(widget.modelId, { widget }, 100, 100);
        let expected;
        if (transform >= 0) {
            const npc = npcTypeLoader.load(transform);
            assert.ok(npc?.chatheadModelIds?.length, 'active-cache NPC has a real head');
            expected = npcFactory.get(npc);
        } else expected = playerFactory.get(appearance);
        const actualHash = fingerprint(actual), expectedHash = fingerprint(expected);
        rows.push({label,transform,actualHash,expectedHash,heads: transform < 0 ? undefined : npcTypeLoader.load(transform).chatheadModelIds});
        if (actualHash !== expectedHash) failures.push(label);
        return { actualHash, expectedHash };
    }
    const ordinary = step('ordinary', -1);
    const gnocci = step('gnocci', 7972);
    const repeat = step('repeat-gnocci', 7972);
    const bugs = step('different-npc', 7969);
    const npcColors = step('gnocci-player-colors-ignored', 7972, [1,0,0,0,1]);
    const restored = step('restored', -1);
    const recolored = step('ordinary-recolor', -1, [1,0,0,0,1]);
    const repeatOrdinary = step('repeat-restored', -1);
    console.log('CHATHEAD_PROTOCOL_2410 ' + JSON.stringify({ cache: info.name, rows }));
    assert.notEqual(gnocci.expectedHash, bugs.expectedHash, 'distinct actual NPC heads provide a non-vacuous identity control');
    assert.equal(gnocci.expectedHash, npcColors.expectedHash, 'player palettes do not recolor NPC head');
    assert.notEqual(ordinary.expectedHash, recolored.expectedHash, 'native normal player recolor control is effective');
    assert.equal(restored.actualHash, ordinary.actualHash);
    assert.equal(repeatOrdinary.actualHash, ordinary.actualHash);
    assert.equal(repeat.actualHash, gnocci.actualHash);
    assert.deepEqual(failures, [], 'full decoded head->widget->selected native model contract');
    // Exercise a real NpcType transform with a controlled varp and real cache heads.
    // Only the synthetic definition/selector is fixture-owned; models and factories are native.
    const vars = new VarManager(loaders.getVarBitTypeLoader());
    const morphId = 900001, emptyId = 900002, varp = 7999;
    const morph = new NpcType(morphId, info);
    morph.transformVarp = varp;
    morph.transforms = [7972, 7969, -1, emptyId, -1];
    const noHead = new NpcType(emptyId, info);
    const morphLoader: any = { load(id: number) {
        return id === morphId ? morph : id === emptyId ? noHead : npcTypeLoader.load(id);
    } };
    host.osrsClient.npcTypeLoader = morphLoader;
    host.osrsClient.varManager = vars;
    const transformed = { gender: normal.gender, colors: normal.colors, kits: normal.kits,
        equip: normal.equip, npcTransformationId: morphId };
    const ordinaryApp = { gender: normal.gender, colors: [0,0,0,0,0], kits: normal.kits,
        equip: normal.equip, npcTransformationId: -1 };
    const recolorApp = { ...ordinaryApp, colors: [1,0,0,0,1] };
    widget.playerAppearance = transformed;
    for (const [value, id] of [[0,7972], [1,7969], [2,-1], [3,emptyId], [0,7972]] as const) {
        vars.setVarp(varp, value);
        const resolved = morph.transform(vars, morphLoader);
        assert.equal(resolved?.id ?? -1, id, 'real morph resolves selected varp');
        const model = render(widget.modelId, { widget }, 100, 100);
        if (id === -1 || id === emptyId) assert.equal(model, undefined, 'invisible or headless morph draws nothing');
        else assert.equal(fingerprint(model), fingerprint(npcFactory.get(npcTypeLoader.load(id))),
            'morph selection produces the resolved native NPC geometry');
    }

    // Run the real tree cache boundary. The terminal canvas/GL sink records which native
    // head model reached it; cache decisions and widget traversal remain production code.
    const noop = () => {};
    const canvas: any = { width: 800, height: 600, style: {}, addEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        __textureCache: { beginFrame: noop, endFrame: noop } };
    (globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
    (globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };
    const { renderWidgetTreeGL } = await import('../widgets/gl/widgetsGl/renderWidgetTree');
    const treeWidget: any = { uid, groupId: 217, fileId: 2, parentUid: -1, type: 6,
        isIf3: true, x: 0, y: 0, width: 100, height: 100, modelType: 3, modelId: -1,
        isPlayerChathead: true, itemId: -1, modelZoom: 1000 };
    const treeManager: any = new Proxy({ getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
        getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: () => [],
        interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const textures = new Map<string, any>();
    const draws: string[] = [];
    const glr: any = new Proxy({ canvas, width: 800, height: 600,
        gl: new Proxy({}, { get: () => noop }),
        createTextureFromCanvas(key: string, image: any) { const tex = { signature: image.signature }; textures.set(key, tex); return tex; },
        updateTextureFromCanvas(key: string, image: any) {
            const tex = textures.get(key) ?? { signature: image.signature };
            tex.signature = image.signature;
            textures.set(key, tex);
            return tex;
        },
        getTexture(key: string) { return textures.get(key); },
        drawTexture(tex: any) { draws.push(tex.signature); },
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    let sinkCalls = 0;
    const treeClient = { ...host.osrsClient, inputManager: new InputManager() };
    function draw(app: any, animated = false) {
        treeWidget.playerAppearance = app;
        treeWidget.sequenceId = animated ? 1 : -1;
        treeWidget.modelFrame = 0;
        const before = draws.length;
        renderWidgetTreeGL(glr, treeWidget, { widgetManager: treeManager, spriteIndex: {} as any,
            fontLoader: () => undefined, hostW: 800, hostH: 600, skipTooltip: true, visible: new Map(),
            game: { osrsClient: treeClient } as any,
            renderModelCanvas: (id, params, width, height) => {
                sinkCalls++;
                const model = render(id, params, width, height);
                return model ? { canvas: { width: 100, height: 100, signature: fingerprint(model) },
                    offsetX: 0, offsetY: 0 } as any : undefined;
            } });
        assert.ok(draws.length - before <= 1, 'one head draw at most');
        return draws.length === before ? undefined : draws.at(-1);
    }
    const ordinaryHash = fingerprint(playerFactory.get(ordinaryApp as any));
    const recolorHash = fingerprint(playerFactory.get(recolorApp as any));
    assert.notEqual(ordinaryHash, recolorHash, 'outer-cache ordinary recolor is non-vacuous');
    assert.equal(draw(ordinaryApp), ordinaryHash);
    let calls = sinkCalls;
    assert.equal(draw(ordinaryApp), ordinaryHash);
    assert.equal(sinkCalls, calls, 'unchanged static ordinary head uses the real outer cache');
    assert.equal(draw(recolorApp), recolorHash, 'ordinary recolor invalidates identity');
    vars.setVarp(varp, 0);
    assert.equal(draw(transformed), gnocci.expectedHash);
    vars.setVarp(varp, 1);
    assert.equal(draw(transformed), bugs.expectedHash, 'same snapshot resolves a changed morph');
    vars.setVarp(varp, 2);
    calls = sinkCalls;
    assert.equal(draw(transformed), undefined, 'invisible morph does not reuse earlier raster');
    assert.equal(sinkCalls, calls + 1, 'invisible morph reaches the native model consumer');
    vars.setVarp(varp, 3);
    calls = sinkCalls;
    assert.equal(draw(transformed), undefined, 'headless morph does not reuse earlier raster');
    assert.equal(sinkCalls, calls + 1, 'headless morph reaches the native model consumer');
    vars.setVarp(varp, 0);
    assert.equal(draw(transformed), gnocci.expectedHash, 'visible morph restores its head');
    assert.equal(draw(ordinaryApp), ordinaryHash, 'normal head restored after morph');
    assert.equal(draw(ordinaryApp, true), ordinaryHash);
    calls = sinkCalls;
    assert.equal(draw(ordinaryApp, true), ordinaryHash);
    assert.equal(sinkCalls, calls, 'unchanged animated ordinary head reuses its memo');
    assert.equal(draw(recolorApp, true), recolorHash, 'same animated frame observes recolor');
    assert.equal(sinkCalls, calls + 1, 'changed animated appearance reaches the model consumer');
    calls = sinkCalls;
    assert.equal(draw(recolorApp, true), recolorHash);
    assert.equal(sinkCalls, calls, 'recolored animated head reuses its memo');
    calls = sinkCalls;
    assert.equal(draw(transformed, true), gnocci.expectedHash);
    assert.equal(sinkCalls, calls + 1, 'animated transformed head reaches the model consumer');
    vars.setVarp(varp, 1);
    assert.equal(draw(transformed, true), bugs.expectedHash, 'same animated frame observes morph');
    assert.equal(sinkCalls, calls + 2, 'changed morph bypasses animated memo');
    assert.equal(draw(recolorApp, true), recolorHash, 'returning to the same ordinary appearance redraws overwritten texture');
    assert.equal(sinkCalls, calls + 3, 'ordinary head reaches consumer after dynamic texture overwrite');
    calls = sinkCalls;
    assert.equal(draw(recolorApp, true), recolorHash);
    assert.equal(sinkCalls, calls, 'restored ordinary head reuses its new memo');
    } finally {
        try {
            ecsForCleanup?.reset();
        } finally {
            globals.forEach((key, index) => {
                const descriptor = descriptors[index];
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else delete (globalThis as any)[key];
            });
        }
    }
});

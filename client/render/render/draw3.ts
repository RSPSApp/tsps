import { isGearTextureId } from "../../custom/items/GearVisualRegistry";
import Denque from "denque";
import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { button, folder } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import {
    DrawCall,
    Framebuffer,
    App as PicoApp,
    PicoGL,
    Program,
    Renderbuffer,
    Texture,
    Timer,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import {
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendEmote,
    sendInteractFollow,
    sendInteractStop,
    subscribeTick,
} from "../../network/ServerConnection";
import { sendLogin } from "../../network/ServerConnection";
import { flushPackets } from "../../network/packet";
import { createTextureArray } from "../../picogl/PicoTexture";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { CollisionFlag } from "../../common/CollisionFlag";
import {
    getWorldLocChanges,
    getWorldLocSpawns,
    getWorldTerrainOverrides,
} from "../../common/gamemode/GamemodeContentStore";
import { OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuTargetType } from "../../rs/MenuEntry";
import type { OverlayFloorType } from "../../rs/config/floortype/OverlayFloorType";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcDrawPriority, NpcType } from "../../rs/config/npctype/NpcType";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { getMapIndexFromTile, getMapPlaneId, getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { ModelData } from "../../rs/model/ModelData";
import { Scene } from "../../rs/scene/Scene";
import { getUiScale } from "../../ui/UiScale";
import { ClickCrossOverlay } from "../../ui/devoverlay/ClickCrossOverlay";
import { GroundItemOverlay } from "../../ui/devoverlay/GroundItemOverlay";
import { HealthBarOverlay } from "../../ui/devoverlay/HealthBarOverlay";
import { HitsplatOverlay } from "../../ui/devoverlay/HitsplatOverlay";
import {
    InteractHighlightDrawTarget,
    InteractHighlightOverlay,
} from "../../ui/devoverlay/InteractHighlightOverlay";
import { LoadingMessageOverlay } from "../../ui/devoverlay/LoadingMessageOverlay";
import { LoginOverlay } from "../../ui/devoverlay/LoginOverlay";
import { OverheadPrayerOverlay } from "../../ui/devoverlay/OverheadPrayerOverlay";
import { OverheadTextOverlay } from "../../ui/devoverlay/OverheadTextOverlay";
import {
    HealthBarEntry,
    HitsplatEntry,
    OverheadPrayerEntry,
    OverheadTextEntry,
    type OverlayUpdateArgs,
    RenderPhase,
} from "../../ui/devoverlay/Overlay";
import { OverlayManager } from "../../ui/devoverlay/OverlayManager";
import type { TileMarkerOverlay } from "../../ui/devoverlay/TileMarkerOverlay";
import { TileTextOverlay } from "../../ui/devoverlay/TileTextOverlay";
import { WidgetsOverlay } from "../../ui/devoverlay/WidgetsOverlay";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, menuAction } from "../../ui/menu/MenuAction";
import { worldEntriesToSimple } from "../../ui/menu/MenuBridge";
import type { MenuClickContext, SimpleMenuEntry } from "../../ui/menu/MenuEngine";
import { chooseDefaultMenuEntry, shouldLeftClickOpenMenu } from "../../ui/menu/MenuEngine";
import { MenuOpcode } from "../../ui/menu/MenuState";
import { Model2DRenderer } from "../../ui/model/Model2DRenderer";
import {
    canTargetGroundItem,
    canTargetNpc,
    canTargetObject,
    canTargetPlayer,
} from "../../widgets/WidgetFlags";
import { WidgetLoader } from "../../widgets/WidgetLoader";
import { WidgetManager } from "../../widgets/WidgetManager";
import { layoutWidgets } from "../../widgets/layout/WidgetLayout";
import { collectWidgetsAtPoint } from "../../widgets/menu/utils";
import {
    getCanvasCssSize,
    isIos,
    isMobileMode,
    isTouchDevice,
    isWebGL2Supported,
} from "../../common/utils/DeviceUtil";
import { clamp } from "../../common/utils/MathUtil";
import { ClientState } from "../../game/ClientState";
import { GameRenderer } from "../../game/GameRenderer";
import type { HitsplatEventPayload } from "../../game/GameRenderer";
import { OsrsRendererType, WEBGL } from "../../game/GameRenderers";
import { ClickMode, getMousePos } from "../../game/InputManager";
import { OsrsClient } from "../../game/OsrsClient";
import { ActorAnimationClip } from "../../game/actor/ActorAnimation";
import {
    ActorHealthBarsState,
    ActorHitsplatState,
    HealthBarBarState,
    HealthBarDefinitionState,
    HealthBarUpdateState,
    MAX_HITSPLAT_SLOTS,
    createActorHealthBarsState,
    createActorHitsplatState,
} from "../../game/actor/ActorOverlayState";
import type { ClientGroundItemStack, GroundItemOverlayEntry } from "../../game/data/ground/GroundItemStore";
import { NpcEcs } from "../../game/ecs/NpcEcs";
import type { PlayerAnimKey } from "../../game/ecs/PlayerEcs";
import { GameState, LoginIndex } from "../../game/login";
import { Ray, rayIntersectsBox } from "../../game/math/Raycast";
import { isMouseInUIRegion as checkMouseInUIRegion } from "../../game/menu/WorldMenuBuilder";
import {
    advanceAnimation,
    computeMovementOrientation,
    computeMovementStep,
    interpolateRotation,
    parseInteractionTarget,
} from "../../game/movement/NpcClientTick";
import type { TileMarkersPluginConfig } from "../../game/plugins/tilemarkers/types";
import { computeRoofPlaneLimit } from "../../game/roof/RoofVisibility";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import {
    BridgePlaneStrategy,
    resolveBridgePromotedPlane,
    resolveCollisionSamplePlaneForLocal,
    resolveCollisionSamplePlaneForWorldTile,
    resolveGroundItemStackPlane,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
    resolveInteractionPlaneForWorldTile,
} from "../../game/scene/PlaneResolver";
import { SceneRaycastHit, SceneRaycaster } from "../../game/scene/SceneRaycaster";
import {
    TILE_FLAG_BRIDGE,
    getTileRenderFlagAt as lookupTileRenderFlagAt,
} from "../../game/scene/TileRenderFlags";
import { LoadingRequirement } from "../../game/state/LoadingTracker";
import type { PlayerSpotAnimationEvent } from "../../game/sync/PlayerSyncTypes";
import { RAD_TO_RS_UNITS, computeFacingRotation } from "../../game/utils/rotation";
import { AnimationFrames } from "../AnimationFrames";
import { ChatheadFactory } from "../ChatheadFactory";
import { type DrawBackend, createDrawBackend } from "../DrawBackend";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { profiler } from "../PerformanceProfiler";
import { PlayerChatheadFactory } from "../PlayerChatheadFactory";
import { resolveFogRange } from "../RenderDistancePolicy";
import { WebGLMapSquare } from "../WebGLMapSquare";
import { WorldEntityAnimator } from "../WorldEntityAnimator";
import { SceneBuffer } from "../buffer/SceneBuffer";
import { getModelFaces, isModelFaceTransparent } from "../buffer/SceneBuffer";
import { GfxManager } from "../gfx/GfxManager";
import { GfxRenderer } from "../gfx/GfxRenderer";
import { buildGroundItemGeometry } from "../ground/GroundItemMeshBuilder";
import { type MinimapIcon, SdMapData } from "../loader/SdMapData";
import { SdMapDataLoader } from "../loader/SdMapDataLoader";
import { SdMapLoaderInput } from "../loader/SdMapLoaderInput";
import { isDoorLocType } from "../loc/SceneLocs";
import {
    DynamicNpcAnimLoader,
    DynamicNpcFrameGeometry,
    DynamicNpcSequenceMeta,
} from "../npc/DynamicNpcAnimLoader";
import { PlayerRenderer } from "../player/PlayerRenderer";
import { ProjectileManager } from "../projectiles/ProjectileManager";
import { ProjectileRenderer } from "../projectiles/ProjectileRenderer";
import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
    createPlayerProgram,
    createProjectileProgram,
} from "../shaders/Shaders";
import { KNOWN_WATER_TEXTURE_IDS } from "../water/WaterTextureIds";
import type { WebGLOsrsRendererHost } from "./hostInterface";
import { RENDER_CONSTANTS } from "./constants";

export function updateGroundItemMeshes(host: WebGLOsrsRendererHost, stacks: ClientGroundItemStack[]): boolean {

        let modelsPending = false;
        const grouped = new Map<number, ClientGroundItemStack[]>();
        for (const stack of stacks) {
            const tileX = stack.tile.x | 0;
            const tileY = stack.tile.y | 0;

            // Check if this ground item falls within a WorldView overlay
            let mapId: number;
            const wv = host.osrsClient.worldViewManager.findWorldViewAt(tileX, tileY);
            if (wv && !wv.isTopLevel()) {
                mapId = wv.overlayMapId;
            } else {
                const mapX = tileX >> 6;
                const mapY = tileY >> 6;
                if (mapX < 0 || mapY < 0) continue;
                mapId = getMapSquareId(mapX, mapY);
            }

            const clone: ClientGroundItemStack = {
                ...stack,
                itemId: stack.itemId | 0,
                quantity: Math.max(1, stack.quantity | 0),
                tile: { x: tileX, y: tileY, level: stack.tile.level | 0 },
            };
            const list = grouped.get(mapId);
            if (list) list.push(clone);
            else grouped.set(mapId, [clone]);
        }

        const allKeys = new Set<number>([...host.groundItemStacks.keys(), ...grouped.keys()]);
        for (const key of allKeys) {
            const next = grouped.get(key) ?? [];
            const hashNext = next.length > 0 ? host.hashGroundStacks(next) : "";
            const prevHash = host.groundItemStackHashes.get(key) ?? "";
            if (hashNext !== prevHash) {
                if (next.length > 0) {
                    host.groundItemStacks.set(key, next);
                    host.groundItemStackHashes.set(key, hashNext);
                } else {
                    host.groundItemStacks.delete(key);
                    host.groundItemStackHashes.delete(key);
                }

                const mapX = key >> 8;
                const mapY = key & 0xff;
                const map = host.mapManager.getMap(mapX, mapY) as WebGLMapSquare | undefined;
                if (map) {
                    if (host.rebuildGroundItemsForMap(map, next)) {
                        // Sparse JS5 models arrive later; leave this map dirty so the next server tick retries it.
                        host.groundItemStackHashes.delete(key);
                        modelsPending = true;
                    }
                }
            }
        }
        return modelsPending;
}

export function hashGroundStacks(host: WebGLOsrsRendererHost, stacks: ClientGroundItemStack[]): string {

        return stacks
            .slice()
            .sort(
                (a, b) =>
                    a.tile.x - b.tile.x ||
                    a.tile.y - b.tile.y ||
                    a.tile.level - b.tile.level ||
                    a.itemId - b.itemId ||
                    a.quantity - b.quantity ||
                    (a.id | 0) - (b.id | 0),
            )
            .map(
                (stack) =>
                    `${stack.tile.x},${stack.tile.y},${stack.tile.level},${stack.itemId},${stack.quantity},${stack.id}`,
            )
            .join("|");
    
}

export function rebuildGroundItemsForMap(host: WebGLOsrsRendererHost, 
        map: WebGLMapSquare,
        stacks: ClientGroundItemStack[] | undefined,
    ): boolean {

        const hasStacks = !!stacks?.length;
        if (!host.mainProgram || !host.mainAlphaProgram) return hasStacks;
        if (
            !host.textureArray ||
            !host.textureMaterials ||
            !host.waterTextures ||
            !host.sceneUniformBuffer
        )
            return hasStacks;
        const objModelLoader = host.osrsClient.objModelLoader;
        const textureLoader = host.osrsClient.textureLoader;
        if (!objModelLoader || !textureLoader) return hasStacks;

        const missesBefore = objModelLoader.modelLoader?.missCount ?? 0;
        const data = buildGroundItemGeometry(
            map,
            stacks && stacks.length > 0 ? stacks : undefined,
            objModelLoader,
            textureLoader,
            host.textureIdIndexMap,
        );

        if (!data) {
            map.clearGroundItemGeometry();
            return (objModelLoader.modelLoader?.missCount ?? 0) > missesBefore;
        }

        const textureUpdates = new Map<number, Int32Array>();
        for (const texId of data.usedTextureIds) {
            if (isGearTextureId(texId) || host.loadedTextureIds.has(texId)) continue;
            try {
                const pixels = textureLoader.getPixelsArgb(texId, RENDER_CONSTANTS.TEXTURE_SIZE, true, 1.0);
                textureUpdates.set(texId, pixels);
                host.loadedTextureIds.add(texId);
            } catch (err) {
                console.warn("[ground] failed to load texture", texId, err);
            }
        }
        if (textureUpdates.size > 0) {
            host.updateTextureArray(textureUpdates);
        }

        map.updateGroundItemGeometry(
            host.app,
            host.mainProgram,
            host.mainAlphaProgram,
            host.textureArray,
            host.textureMaterials,
            host.waterTextures,
            host.sceneUniformBuffer,
            data,
        );
        return false;
    
}

import { App as PicoApp, Program, UniformBuffer } from "picogl";

import type { OsrsClient } from "../../game/OsrsClient";
import { sendEmote } from "../../network/ServerConnection";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import type { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import type { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { ChatheadFactory } from "../../render/ChatheadFactory";
import { PlayerChatheadFactory } from "../../render/PlayerChatheadFactory";
import { WIDGET_MODEL_TYPE_LOC, widgetLocModel } from "../../render/render/init/widgetLocModel";
import { ItemIconRenderer } from "../../ui/item/ItemIconRenderer";
import { WidgetsOverlay, WidgetsContext } from "../../ui/devoverlay/WidgetsOverlay";
import { Model2DRenderer } from "../../ui/model/Model2DRenderer";
import { layoutWidgets } from "../../widgets/layout/WidgetLayout";
import { prepareViewportFittedRoots } from "../../widgets/layout/fitWidgetToBounds";
import { WidgetManager } from "../../widgets/WidgetManager";
import { createSharedFontLoader } from "./sharedFontLoader";

export interface WidgetsOverlayRenderMetrics {
    layoutW: number;
    layoutH: number;
    renderScaleX: number;
    renderScaleY: number;
    renderOffsetX: number;
    renderOffsetY: number;
}

/**
 * Backend-neutral adapter for the widget UI host. The WebGL renderer instance satisfies it
 * directly; the WebGPU ui module supplies an app shim ({ width, height, gl: { canvas } }) and
 * its own computeUiRenderMetrics. The lazily-built shared renderers (item icons, model previews,
 * chatheads) live on this object so both backends cache them once.
 */
export interface WidgetsOverlayHost {
    osrsClient: OsrsClient;
    app: PicoApp;
    sceneUniforms?: UniformBuffer;
    computeUiRenderMetrics(bufW: number, bufH: number): WidgetsOverlayRenderMetrics;
    itemIconRenderer?: any;
    model2DRenderer?: Model2DRenderer;
    chatheadFactory?: ChatheadFactory;
    playerChatheadFactory?: PlayerChatheadFactory;
    playerModelLoader2D?: PlayerModelLoader;
    getInteractNpcModelLoader?(): NpcModelLoader | undefined;
    getInteractLocModelLoader?(): LocModelLoader | undefined;
}

/**
 * Scales a portrait so the model fits its row. Projected size is roughly
 * `extent * zoom3d / zoom2d`, so the zoom that fits the widget box comes straight from the
 * model's own bounds - one arithmetic pass, and the render it feeds is cached per npc.
 */
function fitPortraitParams(model: any, params: any): any {
    model.calculateBoundsCylinder?.();
    const box = params.widget;
    const boxHeight = Math.max(1, (box?.height | 0) - 2);
    const boxWidth = Math.max(1, (box?.width | 0) - 2);
    const modelHeight = Math.max(1, model.height | 0);
    const modelWidth = Math.max(1, (model.xzRadius | 0) * 2);
    const zoom3d = Math.max(1, (params.zoom3d ?? 512) | 0);
    const zoom2d = Math.max(
        (modelHeight * zoom3d) / boxHeight,
        (modelWidth * zoom3d) / boxWidth,
    );
    return { ...params, zoom2d: Math.max(1, zoom2d | 0) };
}

/** Chatbox interface group (chatlog + input), mirrored from the widget layer. */
const CHATBOX_GROUP_ID = 162;

/**
 * Screen-rect of the chatbox in main-canvas pixels (top-left origin), used to
 * anchor the system-update countdown just above the chatbox. The chat group
 * (162) is mounted into a gameframe slot (WIDGET_OPEN_SUB) and the render
 * pass draws the mounted root at the slot's origin plus the root's own
 * offset - the root's cached x/y alone (0,0) would anchor the text to the
 * screen's top-left corner. So the layout-space absolute position is walked
 * from the hosting slot (like the widget overlay's containerOf(162)), with
 * the chat root's own walk as fallback when the group is not mounted. The
 * result goes through the widget root's letterbox transform (the same
 * __widgetRenderScale/Offset the render pass applies).
 */
export function getChatboxScreenRect(host: { osrsClient: OsrsClient }): {
    x: number;
    y: number;
    width: number;
    height: number;
} | undefined {
    try {
        const manager = host.osrsClient?.widgetManager;
        if (!manager) return undefined;
        const chatRoots = manager.getAllGroupRoots?.(CHATBOX_GROUP_ID) ?? [];
        const chatRoot = chatRoots[0];
        if (!chatRoot) return undefined;

        // The slot widget hosting the chat group, if this layout mounts it.
        let slot: any;
        const parents = (manager as any).interfaceParents;
        if (parents && typeof parents[Symbol.iterator] === "function") {
            for (const [uid, parent] of parents) {
                if (parent?.group === CHATBOX_GROUP_ID) {
                    slot = (manager as any).getWidgetByUid?.(uid);
                    break;
                }
            }
        }

        // Layout-space absolute position (sum of ancestor x/y, like the
        // gameframe context's absRectOf).
        let ax = 0;
        let ay = 0;
        let cur: any = slot ?? chatRoot;
        for (let guard = 0; cur && guard < 32; guard++) {
            ax += Number(cur.x) || 0;
            ay += Number(cur.y) || 0;
            const parentUid = cur.parentUid;
            if (parentUid === undefined || parentUid === 0xffff || parentUid === cur.uid) break;
            cur = (manager as any).getWidgetByUid?.(parentUid);
        }
        if (slot) {
            // The mounted root is drawn at the slot's origin plus its own offset.
            ax += Number(chatRoot.x) || 0;
            ay += Number(chatRoot.y) || 0;
        }

        const rootInterface: number | undefined = manager.rootInterface;
        const viewportRoot =
            typeof rootInterface === "number" && rootInterface >= 0
                ? (manager.getAllGroupRoots?.(rootInterface)?.[0] ?? null)
                : null;
        const renderScaleX =
            typeof (viewportRoot as any)?.__widgetRenderScaleX === "number"
                ? (viewportRoot as any).__widgetRenderScaleX
                : 1;
        const renderScaleY =
            typeof (viewportRoot as any)?.__widgetRenderScaleY === "number"
                ? (viewportRoot as any).__widgetRenderScaleY
                : 1;
        const renderOffsetX =
            typeof (viewportRoot as any)?.__widgetRenderOffsetX === "number"
                ? (viewportRoot as any).__widgetRenderOffsetX
                : 0;
        const renderOffsetY =
            typeof (viewportRoot as any)?.__widgetRenderOffsetY === "number"
                ? (viewportRoot as any).__widgetRenderOffsetY
                : 0;

        const x = ax * renderScaleX + renderOffsetX;
        const y = ay * renderScaleY + renderOffsetY;
        const width = (Number(chatRoot.width) || Number(slot?.width) || 0) * renderScaleX;
        const height = (Number(chatRoot.height) || Number(slot?.height) || 0) * renderScaleY;
        if (!(width > 0 && height > 0)) return undefined;
        return { x, y, width, height };
    } catch {
        return undefined;
    }
}

/**
 * Builds the widget overlay (HUD, gameframe, menus, minimap, tooltips) against a backend-neutral
 * host. Extracted verbatim from client/render/render/init/shaders.ts so the WebGPU ui module can
 * build and drive the same overlay without a PicoGL context.
 */
export function createWidgetsOverlay(host: WidgetsOverlayHost): WidgetsOverlay {
    try {
                        // Get required loaders from OsrsClient
                        const objLoader = host.osrsClient.objTypeLoader;
                        const modelLoader = host.osrsClient.modelLoader;
                        const textureLoader = host.osrsClient.textureLoader;
                        const idkLoader = host.osrsClient.idkTypeLoader;

                        // Create item icon renderer if we have the necessary loaders
                        // Will be reinitialized in initOverlays() if not available now
                        if (objLoader && modelLoader && textureLoader && !host.itemIconRenderer) {
                            host.itemIconRenderer = new ItemIconRenderer(
                                objLoader,
                                modelLoader,
                                textureLoader,
                                host.osrsClient.cacheSystem,
                            );
                        }
                        if (modelLoader && textureLoader && idkLoader) {
                            host.playerChatheadFactory = new PlayerChatheadFactory(
                                modelLoader,
                                textureLoader,
                                idkLoader,
                            );
                        }

                        // Root interface is set by the server via set_root widget event
                        let resolvedGroupId: number | undefined;
                        if (!host.osrsClient.widgetManager && host.osrsClient.cacheSystem) {
                            host.osrsClient.widgetManager = new WidgetManager(host.osrsClient.cacheSystem);
                        }

                        const computeWidgetRoots = (): any[] => {
                            const manager = host.osrsClient.widgetManager;
                            const roots: any[] = [];

                            // NOTE: beginFrame() is now called at the END of draw, not here.
                            // This ensures dirty flags set during the frame are visible to the dirty check.

                            // Widget layout runs in renderer-defined UI space and renders directly into the
                            // canvas buffer.
                            const bufW = host.app.width;
                            const bufH = host.app.height;
                            const metrics = host.computeUiRenderMetrics(bufW, bufH);
                            const layoutW = metrics.layoutW;
                            const layoutH = metrics.layoutH;
                            const widgetRenderScaleX = metrics.renderScaleX;
                            const widgetRenderScaleY = metrics.renderScaleY;
                            const widgetRenderOffsetX = metrics.renderOffsetX;
                            const widgetRenderOffsetY = metrics.renderOffsetY;

                            // Keep CS2 IF_GETCANVASSIZE / widget manager dimensions aligned with the active
                            // widget layout space.
                            manager?.resize(layoutW, layoutH);
                            host.osrsClient.clientPlugins.updateWidgetLayout();

                            // Get the current root interface (set by server via IF_OPENTOPLEVEL)
                            // OSRS interfaces can have multiple root widgets (parentUid=-1)
                            // All of them need to be rendered as top-level layers
                            const currentRootInterface = manager?.rootInterface ?? -1;
                            if (currentRootInterface !== -1) {
                                const allRoots = manager?.getAllGroupRoots(currentRootInterface) ?? [];

                                // Helper to count children (both dynamic from children array AND static from parentUid)
                                const getChildCount = (w: any): number => {
                                    const dynamicCount = w.children?.length ?? 0;
                                    // also count static children from parentUid filtering
                                    const staticCount =
                                        manager?.getStaticChildrenByParentUid(w.uid)?.length ?? 0;
                                    return dynamicCount + staticCount;
                                };

                                for (const viewportRoot of allRoots) {
                                    if (viewportRoot) {
                                        // Layout each root independently in the current UI layout space.
                                        // Pass static children callback for
                                        const getStaticChildren = (uid: number) =>
                                            manager?.getStaticChildrenByParentUid(uid) ?? [];
                                        layoutWidgets(
                                            viewportRoot,
                                            layoutW | 0,
                                            layoutH | 0,
                                            getStaticChildren,
                                        );

                                        // Skip empty layer roots from rendering
                                        const childCount = getChildCount(viewportRoot);
                                        const hasMountedInterface =
                                            manager?.interfaceParents.has(viewportRoot.uid) === true;
                                        const hasVisualContent =
                                            viewportRoot.type !== 0 ||
                                            childCount > 0 ||
                                            hasMountedInterface ||
                                            (typeof viewportRoot.spriteId === "number" &&
                                                viewportRoot.spriteId >= 0) ||
                                            (typeof viewportRoot.spriteId2 === "number" &&
                                                viewportRoot.spriteId2 >= 0) ||
                                            viewportRoot.filled;

                                        if (!hasVisualContent) {
                                            continue;
                                        }

                                        // Register root widget for dirty tracking
                                        const rootAny = viewportRoot as any;
                                        rootAny.__widgetRenderScale = widgetRenderScaleX;
                                        rootAny.__widgetRenderScaleX = widgetRenderScaleX;
                                        rootAny.__widgetRenderScaleY = widgetRenderScaleY;
                                        rootAny.__widgetRenderOffsetX = widgetRenderOffsetX;
                                        rootAny.__widgetRenderOffsetY = widgetRenderOffsetY;
                                        const rootX = (viewportRoot.x ?? 0) | 0;
                                        const rootY = (viewportRoot.y ?? 0) | 0;
                                        const rootW = (viewportRoot.width ?? layoutW) | 0;
                                        const rootH = (viewportRoot.height ?? layoutH) | 0;
                                        const drawX = Math.round(
                                            rootX * widgetRenderScaleX + widgetRenderOffsetX,
                                        );
                                        const drawY = Math.round(
                                            rootY * widgetRenderScaleY + widgetRenderOffsetY,
                                        );
                                        const drawRight = Math.round(
                                            (rootX + rootW) * widgetRenderScaleX + widgetRenderOffsetX,
                                        );
                                        const drawBottom = Math.round(
                                            (rootY + rootH) * widgetRenderScaleY + widgetRenderOffsetY,
                                        );
                                        manager?.registerRootWidget(
                                            viewportRoot,
                                            drawX,
                                            drawY,
                                            Math.max(1, drawRight - drawX),
                                            Math.max(1, drawBottom - drawY),
                                        );

                                        roots.push(viewportRoot);
                                    }
                                }
                                if (allRoots.length > 0 && resolvedGroupId !== currentRootInterface) {
                                    resolvedGroupId = currentRootInterface;
                                }
                            }

                            if (manager) roots.push(...prepareViewportFittedRoots(manager, {
                                scaleX: widgetRenderScaleX, scaleY: widgetRenderScaleY,
                                offsetX: widgetRenderOffsetX, offsetY: widgetRenderOffsetY,
                            }));
                            return roots;
                        };

                        const fontLoader = createSharedFontLoader(() => host.osrsClient.cacheSystem);

                        const widgets = new WidgetsOverlay(undefined as unknown as Program, {
                            getCacheSystem: () => host.osrsClient.cacheSystem,
                            getWidgetManager: () => host.osrsClient.widgetManager,
                            getGameContext: () => ({
                                osrsClient: host.osrsClient,
                                playerEcs: host.osrsClient.playerEcs,
                                controlledPlayerServerId: host.osrsClient.controlledPlayerServerId,
                                combatWeaponCategory: host.osrsClient.combatWeaponCategory,
                                combatWeaponItemId: host.osrsClient.combatWeaponItemId,
                                sendEmote,
                            }),
                            getFontLoader: () => fontLoader,
                            getWidgetRoots: () => computeWidgetRoots(),
                            getWidgetRoot: () => {
                                const roots = computeWidgetRoots();
                                return roots.length > 0 ? roots[roots.length - 1] : undefined;
                            },
                            getItemIconCanvas:
                                () =>
                                    (
                                        itemId: number,
                                        qty?: number,
                                        outline?: number,
                                        shadow?: number,
                                        quantityMode?: number,
                                    ) => {
                                        // Use ItemIconRenderer to render item icons. Create it lazily:
                                        // loaders can become ready after the overlay is built (WebGPU
                                        // builds it in initCache; WebGL used to re-create it in initOverlays).
                                        if (
                                            !host.itemIconRenderer &&
                                            host.osrsClient.objTypeLoader &&
                                            host.osrsClient.modelLoader &&
                                            host.osrsClient.textureLoader
                                        ) {
                                            host.itemIconRenderer = new ItemIconRenderer(
                                                host.osrsClient.objTypeLoader,
                                                host.osrsClient.modelLoader,
                                                host.osrsClient.textureLoader,
                                                host.osrsClient.cacheSystem,
                                            );
                                        }
                                        if (host.itemIconRenderer) {
                                            return host.itemIconRenderer.renderToCanvas(itemId, qty ?? 1, {
                                                outline,
                                                shadow,
                                                quantityMode,
                                            });
                                        }
                                        return undefined;
                                    },
                            getObjLoader: () => {
                                // Return the object loader from OsrsClient
                                return host.osrsClient.objTypeLoader;
                            },
                            getRenderModelCanvas:
                                () => (modelId: number, params: any, width: number, height: number) => {
                                    if (!host.model2DRenderer) {
                                        host.model2DRenderer = new Model2DRenderer(
                                            host.osrsClient.objTypeLoader,
                                            host.osrsClient.modelLoader,
                                            host.osrsClient.textureLoader,
                                            host.osrsClient.seqTypeLoader,
                                            host.osrsClient.seqFrameLoader,
                                            host.osrsClient.skeletalSeqLoader,
                                        );
                                    }

                                    if (params.widget) {
                                        const isPlayerModelWidget =
                                            ((params.widget.contentType ?? 0) | 0) === 328 ||
                                            ((params.widget.modelType ?? 0) | 0) === 7 ||
                                            (params.widget as any).isPlayerModel === true;
                                        if (isPlayerModelWidget) {
                                            const haveLoaders =
                                                host.osrsClient.modelLoader &&
                                                host.osrsClient.textureLoader &&
                                                host.osrsClient.idkTypeLoader &&
                                                host.osrsClient.objTypeLoader;
                                            if (!host.playerModelLoader2D && haveLoaders) {
                                                host.playerModelLoader2D = new PlayerModelLoader(
                                                    host.osrsClient.idkTypeLoader,
                                                    host.osrsClient.objTypeLoader,
                                                    host.osrsClient.modelLoader,
                                                    host.osrsClient.textureLoader,
                                                );
                                            }

                                            const wAny = params.widget as any;
                                            const keepEquipment =
                                                typeof wAny.playerModelKeepEquipment === "boolean"
                                                    ? (wAny.playerModelKeepEquipment as boolean)
                                                    : true;
                                            // contentType=328 renders the local player model.
                                            // Prefer the ECS local-player appearance so server-driven updates
                                            // (PlayerDesign arrows) reflect immediately, even if the widget
                                            // has a stale `playerAppearance` snapshot.
                                            const localAppearance = (() => {
                                                const idx = host.osrsClient.playerEcs.getIndexForServerId(
                                                    host.osrsClient.controlledPlayerServerId,
                                                );
                                                return idx !== undefined
                                                    ? host.osrsClient.playerEcs.getAppearance(idx)
                                                    : undefined;
                                            })();
                                            const appearanceSrc =
                                                ((params.widget as any).contentType | 0) === 328
                                                    ? localAppearance || wAny.playerAppearance
                                                    : wAny.playerAppearance || localAppearance;

                                            if (host.playerModelLoader2D && appearanceSrc) {
                                                const gender =
                                                    typeof appearanceSrc.gender === "number"
                                                        ? appearanceSrc.gender | 0
                                                        : 0;
                                                const colors = Array.isArray(appearanceSrc.colors)
                                                    ? appearanceSrc.colors
                                                        .slice(0, 5)
                                                        .map((n: any) =>
                                                            Number.isFinite(n) ? (n | 0) & 0xff : 0,
                                                        )
                                                    : [0, 0, 0, 0, 0];
                                                const kits = Array.isArray(appearanceSrc.kits)
                                                    ? appearanceSrc.kits
                                                        .slice(0, 7)
                                                        .map((n: any) =>
                                                            Number.isFinite(n) ? n | 0 : -1,
                                                        )
                                                    : new Array(7).fill(-1);
                                                const equip = Array.isArray(appearanceSrc.equip)
                                                    ? appearanceSrc.equip
                                                        .slice(0, 14)
                                                        .map((n: any) =>
                                                            Number.isFinite(n) ? n | 0 : -1,
                                                        )
                                                    : new Array(14).fill(-1);
                                                if (!keepEquipment) {
                                                    for (let i = 0; i < equip.length; i++) equip[i] = -1;
                                                }
                                                const pa = new PlayerAppearance(
                                                    gender,
                                                    colors,
                                                    kits,
                                                    equip,
                                                );

                                                // contentType=328 uses KeyHandler.localPlayer.getModel().
                                                // Our ECS base-model pipeline applies additional alignment (to NPC "man")
                                                // which is correct for in-world rendering, but skews UI preview offsets.
                                                // For widget rendering, prefer the raw PlayerComposition model build.
                                                let model: any | undefined;
                                                if (host.playerModelLoader2D) {
                                                    model =
                                                        host.playerModelLoader2D.buildStaticModelFromEquipment(
                                                            pa,
                                                            pa.equip,
                                                        );
                                                }
                                                if (model) {
                                                    // Widget type-6 models render into the *parent clip*,
                                                    // not the widget bounds. This means player models can overflow the
                                                    // widget rectangle (e.g., equipment/league summary) and still be visible.
                                                    //
                                                    // Render to tight extents and let the widget scissor stack (container clip)
                                                    // match the client's behaviour.
                                                    return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                        model,
                                                        params,
                                                    );
                                                }
                                            }
                                        }

                                        if (
                                            params.widget.isNpcChathead &&
                                            typeof params.widget.npcTypeId === "number"
                                        ) {
                                            if (!host.chatheadFactory) {
                                                host.chatheadFactory = new ChatheadFactory(
                                                    host.osrsClient.modelLoader,
                                                    host.osrsClient.textureLoader,
                                                );
                                            }
                                            const npcTypeId = params.widget.npcTypeId;
                                            const baseNpcType =
                                                host.osrsClient.npcTypeLoader.load(npcTypeId);
                                            const npcType =
                                                baseNpcType?.transform?.(
                                                    host.osrsClient.varManager,
                                                    host.osrsClient.npcTypeLoader,
                                                ) ?? baseNpcType;
                                            const portrait = params.widget.npcPortraitFit === true;
                                            if (
                                                npcType &&
                                                npcType.chatheadModelIds &&
                                                npcType.chatheadModelIds.length > 0
                                            ) {
                                                const chatModel = host.chatheadFactory.get(npcType);
                                                if (chatModel) {
                                                    return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                        chatModel,
                                                        portrait ? fitPortraitParams(chatModel, params) : params,
                                                    );
                                                }
                                            }
                                            if (portrait) {
                                                // ::npcs rows: most npcs have no chathead, so fall back to the
                                                // body model. Both builders cache per npc id.
                                                const npcModelLoader = npcType
                                                    ? host.getInteractNpcModelLoader?.()
                                                    : undefined;
                                                const bodyModel = npcType
                                                    ? npcModelLoader?.getModel(npcType, -1, -1)
                                                    : undefined;
                                                if (bodyModel) {
                                                    return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                        bodyModel,
                                                        fitPortraitParams(bodyModel, params),
                                                    );
                                                }
                                                // modelId is an npc id here, never a model id: draw nothing
                                                // rather than whatever model happens to share the number.
                                                return undefined;
                                            }
                                        } else if (params.widget.isPlayerChathead) {
                                            const haveLoaders =
                                                host.osrsClient.modelLoader &&
                                                host.osrsClient.textureLoader &&
                                                host.osrsClient.idkTypeLoader &&
                                                host.osrsClient.objTypeLoader;

                                            // Recreate factory if missing or if it was built before objTypeLoader was ready
                                            if (
                                                !host.playerChatheadFactory ||
                                                !(host.playerChatheadFactory as any)["objTypeLoader"]
                                            ) {
                                                if (haveLoaders) {
                                                    host.playerChatheadFactory = new PlayerChatheadFactory(
                                                        host.osrsClient.modelLoader,
                                                        host.osrsClient.textureLoader,
                                                        host.osrsClient.idkTypeLoader,
                                                        host.osrsClient.objTypeLoader,
                                                    );
                                                }
                                            }
                                            const appearance =
                                                params.widget.playerAppearance ||
                                                (() => {
                                                    const idx =
                                                        host.osrsClient.playerEcs.getIndexForServerId(
                                                            host.osrsClient.controlledPlayerServerId,
                                                        );
                                                    return idx !== undefined
                                                        ? host.osrsClient.playerEcs.getAppearance(idx)
                                                        : undefined;
                                                })();
                                            if (host.playerChatheadFactory && appearance) {
                                                const chatModel =
                                                    host.playerChatheadFactory.get(appearance);
                                                if (chatModel) {
                                                    return host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                        chatModel,
                                                        params,
                                                    );
                                                }
                                            }
                                        }
                                    }

                                    if (((params.widget?.modelType ?? 0) | 0) === WIDGET_MODEL_TYPE_LOC) {
                                        const locModel = widgetLocModel(
                                            modelId,
                                            host.osrsClient.locTypeLoader,
                                            host.getInteractLocModelLoader?.(),
                                            host.osrsClient.textureLoader,
                                        );
                                        // modelId is a loc id, never a model id.
                                        return locModel
                                            ? host.model2DRenderer.renderModelInstanceToCanvasExtents(
                                                  locModel,
                                                  params,
                                              )
                                            : undefined;
                                    }

                                    const widgetAny = params.widget as any;
                                    const itemId = widgetAny?.itemId;
                                    if (typeof itemId === "number" && itemId >= 0) {
                                        try {
                                            const qty = (widgetAny?.itemQuantity ?? 0) | 0 || 1;
                                            return host.model2DRenderer.renderItemToCanvasExtents(
                                                itemId | 0,
                                                qty,
                                                params,
                                                width,
                                                height,
                                            );
                                        } catch {}
                                    }

                                    if (modelId < 0) {
                                        return undefined;
                                    }

                                    return host.model2DRenderer.renderToCanvasExtents(
                                        modelId,
                                        params,
                                        width,
                                        height,
                                    );
                                },
                        });
                        // Init may fail if cache not ready - will be reinitialized in initOverlays()
                        try {
                            widgets.init({ app: host.app, sceneUniforms: host.sceneUniforms as UniformBuffer });
                        } catch {}
                        console.log(
                            "[widgets] WidgetsOverlay initialized",
                        );

        return widgets;
    } catch (e) {
        console.error("Failed to initialize WidgetsOverlay:", e);
        throw e;
    }
}

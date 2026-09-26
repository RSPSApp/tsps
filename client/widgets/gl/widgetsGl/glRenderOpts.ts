import { CacheIndex } from "../../../rs/cache/CacheIndex";
import { CacheSystem } from "../../../rs/cache/CacheSystem";
import { BitmapFont } from "../../../rs/font/BitmapFont";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import { ClipRect } from "../scissor";
export type GLRenderOpts = {
    spriteIndex: CacheIndex;
    fontLoader: (id: number) => BitmapFont | undefined;
    visible: Map<number, boolean>;
    debug: boolean;
    // When provided, always render debug devoverlay for this node and its descendants
    selectedUid?: number;
    hostW: number;
    hostH: number;
    // Optional: DOM canvas to attach input listeners to
    hostCanvas?: HTMLCanvasElement;
    rewardEnums?: { ids?: number[]; names?: string[] };
    itemIconCanvas?: (
        itemId: number,
        qty?: number,
        outline?: number,
        shadow?: number,
        quantityMode?: number,
    ) => HTMLCanvasElement | undefined;
    objLoader?: any;
    // Optional root render offset in canvas space (for game-area centering)
    rootOffsetX?: number;
    rootOffsetY?: number;
    // Optional root render scale (for matching login-style UI surface scaling)
    rootScale?: number;
    rootScaleX?: number;
    rootScaleY?: number;
    // Optional root-level clip rectangle in canvas space.
    // Used by WidgetsOverlay to redraw only dirty UI regions.
    rootClip?: ClipRect;
    // Optional game context (game client, player ECS, etc.)
    game?: any;
    // When set, hide the root interface's own sprite/rect widgets (chrome) while
    // still rendering its mounted content. rootGroupId is the root interface id.
    hideStockChrome?: boolean;
    rootGroupId?: number;
    // A custom gameframe can hide stock widgets by group or content type.
    widgetRules?: WidgetRule[];
    // Root-interface uids whose own chrome should NOT be hidden by hideStockChrome.
    keepChromeUids?: number[];
    // Access to cache for plugin-driven child loading
    getCacheSystem?: () => CacheSystem;
    widgetManager?: WidgetManager;
    // Optional: request a full repaint from the host overlay when any widget input mutates state.
    requestRepaintAll?: () => void;
    steelFrame?: {
        edges?: { top?: any; bottom?: any; left?: any; right?: any };
        corners?: { tl?: any; tr?: any; bl?: any; br?: any };
        close?: { url: string; w: number; h: number };
        divider?: { url: string; w: number; h: number };
        background?: { url: string };
    };
    scrollbarArrows?: { upUrl: string; downUrl: string };
    scrollbarDragger?: { url: string; w: number; h: number };
    // Generic model renderer for IF3 type-6 widgets
    renderModelCanvas?: (
        modelId: number,
        params: {
            xan2d?: number;
            yan2d?: number;
            zan2d?: number;
            zoom2d?: number;
            zoom3d?: number;
            offsetX2d?: number;
            offsetY2d?: number;
            orthographic?: boolean;
            widget?: any;
            sequenceId?: number;
            sequenceFrame?: number;
            depthTest?: boolean;
            // Lighting parameters
            ambient?: number;
            contrast?: number;
            lightX?: number;
            lightY?: number;
            lightZ?: number;
        },
        width: number,
        height: number,
    ) => { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined;
    openGroup?: (groupId: number | string) => void;
    // Skip legacy GL hover/tooltip text. CS2 tooltip widgets remain rendered normally.
    skipTooltip?: boolean;
};

/** A custom gameframe's rule to hide stock widgets. All specified fields must
 * match (uid, group, type, contentType). */
export type WidgetRule = {
    /** Match an exact widget uid ((group << 16) | child). */
    uid?: number;
    /** Match the widget's interface group (uid >>> 16). */
    group?: number;
    /** Match the widget type (0 container, 3 rect, 4 text, 5 sprite...). */
    type?: number;
    /** Match the widget's contentType (e.g. 1339 = compass). */
    contentType?: number;
    hide?: boolean;
};

import { GLRenderer } from "../renderer";
import { TextureCache } from "../texture-cache";
import type { GLRenderOpts } from "./glRenderOpts";
import { SCROLLBAR_BOTTOM_COLOR, SCROLLBAR_THUMB_COLOR, SCROLLBAR_TOP_COLOR, SCROLLBAR_TRACK_COLOR } from "./constants";
import { scaleLogicalPixels } from "./scaleLogicalPixels";
import { scrollbarThumb } from "./widgetDrawRules";
export function drawScrollBar(
    glr: GLRenderer,
    x: number,
    y: number,
    scrollY: number,
    height: number,
    scrollHeight: number,
    tc: TextureCache,
    opts: GLRenderOpts,
    scaleX: number = 1,
    scaleY: number = 1,
): void {
    x = x | 0;
    y = y | 0;
    height = height | 0;
    scrollHeight = scrollHeight | 0;
    scrollY = scrollY | 0;

    // Scrollbar dimensions
    const SCROLLBAR_WIDTH = scaleLogicalPixels(scaleX, 16);
    const ARROW_HEIGHT = scaleLogicalPixels(scaleY, 16);
    const EDGE_WIDTH = Math.min(SCROLLBAR_WIDTH, scaleLogicalPixels(scaleX, 1));
    const EDGE_HEIGHT = Math.min(Math.max(1, height), scaleLogicalPixels(scaleY, 1));

    const scrollbarSpriteArchiveId = opts.widgetManager?.scrollbarSpriteArchiveId ?? -1;
    const upArrow =
        scrollbarSpriteArchiveId >= 0
            ? tc.getSpriteByArchiveFrame(scrollbarSpriteArchiveId, 0)
            : undefined;
    const downArrow =
        scrollbarSpriteArchiveId >= 0
            ? tc.getSpriteByArchiveFrame(scrollbarSpriteArchiveId, 1)
            : undefined;

    // Draw up arrow
    if (upArrow) {
        glr.drawTexture(upArrow, x, y, SCROLLBAR_WIDTH, ARROW_HEIGHT, 1, 1);
    }

    // Draw down arrow
    if (downArrow) {
        glr.drawTexture(
            downArrow,
            x,
            y + height - ARROW_HEIGHT,
            SCROLLBAR_WIDTH,
            ARROW_HEIGHT,
            1,
            1,
        );
    }

    // Draw track (area between arrows)
    const trackHeight = height - ARROW_HEIGHT * 2;
    if (trackHeight > 0) {
        const tr = ((SCROLLBAR_TRACK_COLOR >>> 16) & 0xff) / 255;
        const tg = ((SCROLLBAR_TRACK_COLOR >>> 8) & 0xff) / 255;
        const tb = (SCROLLBAR_TRACK_COLOR & 0xff) / 255;
        glr.drawRect(x, y + ARROW_HEIGHT, SCROLLBAR_WIDTH, trackHeight, [tr, tg, tb, 1]);
    }

    // Thumb size and position: the visible share of the track, at least 8 pixels tall.
    const thumb = scrollbarThumb(height, scrollY, scrollHeight, ARROW_HEIGHT, scaleLogicalPixels(scaleY, 8));
    const thumbHeight = thumb.height;
    const thumbY = thumb.offset;

    // Draw thumb. OSRS draws it whatever its size, also when it fills the track or more.
    if (thumbHeight > 0) {
        const tr = ((SCROLLBAR_THUMB_COLOR >>> 16) & 0xff) / 255;
        const tg = ((SCROLLBAR_THUMB_COLOR >>> 8) & 0xff) / 255;
        const tb = (SCROLLBAR_THUMB_COLOR & 0xff) / 255;
        const thumbTop = y + ARROW_HEIGHT + thumbY;
        glr.drawRect(x, thumbTop, SCROLLBAR_WIDTH, thumbHeight, [tr, tg, tb, 1]);

        // Draw thumb highlight (left and top edges)
        const hr = ((SCROLLBAR_TOP_COLOR >>> 16) & 0xff) / 255;
        const hg = ((SCROLLBAR_TOP_COLOR >>> 8) & 0xff) / 255;
        const hb = (SCROLLBAR_TOP_COLOR & 0xff) / 255;
        const leftEdgeW = Math.min(SCROLLBAR_WIDTH, EDGE_WIDTH);
        const leftInsetW = Math.min(Math.max(0, SCROLLBAR_WIDTH - leftEdgeW), EDGE_WIDTH);
        const topEdgeH = Math.min(thumbHeight, EDGE_HEIGHT);
        const topInsetH = Math.min(Math.max(0, thumbHeight - topEdgeH), EDGE_HEIGHT);
        if (leftEdgeW > 0) {
            glr.drawRect(x, thumbTop, leftEdgeW, thumbHeight, [hr, hg, hb, 1]);
        }
        if (leftInsetW > 0) {
            glr.drawRect(x + leftEdgeW, thumbTop, leftInsetW, thumbHeight, [hr, hg, hb, 1]);
        }
        if (topEdgeH > 0) {
            glr.drawRect(x, thumbTop, SCROLLBAR_WIDTH, topEdgeH, [hr, hg, hb, 1]);
        }
        if (topInsetH > 0) {
            glr.drawRect(x, thumbTop + topEdgeH, SCROLLBAR_WIDTH, topInsetH, [hr, hg, hb, 1]);
        }

        // Draw thumb shadow (right and bottom edges)
        const sr = ((SCROLLBAR_BOTTOM_COLOR >>> 16) & 0xff) / 255;
        const sg = ((SCROLLBAR_BOTTOM_COLOR >>> 8) & 0xff) / 255;
        const sb = (SCROLLBAR_BOTTOM_COLOR & 0xff) / 255;
        const rightEdgeW = Math.min(SCROLLBAR_WIDTH, EDGE_WIDTH);
        const rightInsetW = Math.min(Math.max(0, SCROLLBAR_WIDTH - rightEdgeW), EDGE_WIDTH);
        const bottomEdgeH = Math.min(thumbHeight, EDGE_HEIGHT);
        const bottomInsetH = Math.min(Math.max(0, thumbHeight - bottomEdgeH), EDGE_HEIGHT);
        if (rightEdgeW > 0) {
            glr.drawRect(x + SCROLLBAR_WIDTH - rightEdgeW, thumbTop, rightEdgeW, thumbHeight, [
                sr,
                sg,
                sb,
                1,
            ]);
        }
        if (rightInsetW > 0 && thumbHeight > topEdgeH) {
            glr.drawRect(
                x + SCROLLBAR_WIDTH - rightEdgeW - rightInsetW,
                thumbTop + topEdgeH,
                rightInsetW,
                thumbHeight - topEdgeH,
                [sr, sg, sb, 1],
            );
        }
        if (bottomEdgeH > 0) {
            glr.drawRect(x, thumbTop + thumbHeight - bottomEdgeH, SCROLLBAR_WIDTH, bottomEdgeH, [
                sr,
                sg,
                sb,
                1,
            ]);
        }
        if (bottomInsetH > 0 && SCROLLBAR_WIDTH > leftEdgeW) {
            glr.drawRect(
                x + leftEdgeW,
                thumbTop + thumbHeight - bottomEdgeH - bottomInsetH,
                SCROLLBAR_WIDTH - leftEdgeW,
                bottomInsetH,
                [sr, sg, sb, 1],
            );
        }
    }
}

// Item icons come from injected 3D renderer via opts.itemIconCanvas only.

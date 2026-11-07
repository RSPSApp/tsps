import { strict as assert } from "node:assert";
import { Color } from "@runelite/awt/Color";
import { Polygon, Rectangle } from "@runelite/awt/Shapes";
import { type Graphics2D, RecordingGraphics2D } from "@runelite/awt/Graphics2D";
import { CanvasTextureCache } from "@runelite/client/ui/overlay/CanvasTextureCache";
import { OverlayPanel } from "@runelite/client/ui/overlay/OverlayPanel";
import { ComponentConstants } from "@runelite/client/ui/overlay/components/ComponentConstants";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";

// RuneLite's overlay components laid out by RuneLite's rules, drawn through a Graphics2D the
// test records: a fixed-width font (6 px a character, 16 px line height) makes every position
// hand-checkable.

const font = { stringWidth: (s: string) => s.length * 6, getHeight: () => 16 };

// --- Colours -----------------------------------------------------------------------------------------
assert.equal(Color.ORANGE.getRGB() >>> 0, 0xffffc800, "java.awt.Color.ORANGE");
assert.equal(new Color(0, 255, 0, 20).getRGB() >>> 0, 0x1400ff00);
assert.equal(Color.decode("#AA00FF").getRGB() >>> 0, 0xffaa00ff);
assert.equal(Color.ORANGE.darker().getRGB() >>> 0, 0xffb28c00, "darker() scales by 0.7");
assert.equal(ComponentConstants.STANDARD_BACKGROUND_COLOR.getRGB() >>> 0, 0x9c463d32, "Color(70, 61, 50, 156)");
assert.equal(ComponentConstants.STANDARD_WIDTH, 129);
assert.equal(ComponentConstants.STANDARD_BORDER, 4);

// --- A panel: title and two lines -------------------------------------------------------------------
{
    const g = new RecordingGraphics2D(font);
    const panel = new PanelComponent();
    panel.getChildren().push(TitleComponent.builder().text("Clue").build());
    panel.getChildren().push(LineComponent.builder().left("NPC:").right("Falo").build());
    panel.getChildren().push(LineComponent.builder().left("Hint").leftColor(Color.YELLOW).build());
    const size = panel.render(g);
    assert.deepEqual(size, { width: 129, height: 2 * 4 + 3 * 16 }, "border + three 16 px lines");
    const background = g.shapes[0];
    assert.equal(background.kind, "fill", "the background is filled first, at the panel's size");
    assert.deepEqual(background.shape.getBounds(), new Rectangle(0, 0, 129, 56));
    assert.equal(background.color, ComponentConstants.STANDARD_BACKGROUND_COLOR.getRGB() >>> 0);
    assert.equal(g.shapes[1].kind, "draw", "then the darker outer stroke");
    assert.equal(g.shapes[1].color, new Color(56, 48, 40, 218).getRGB() >>> 0, "0.8 of the background, alpha 1.4x");
    assert.equal(g.shapes[2].color, new Color(84, 73, 60, 218).getRGB() >>> 0, "the lighter inner stroke, 1.2x");
    const texts = g.strings.filter((s) => s.color !== (Color.BLACK.getRGB() >>> 0));
    assert.deepEqual(texts.map((s) => [s.text, s.x, s.y]), [
        ["Clue", 4 + Math.floor((121 - 24) / 2), 4 + 16],
        ["NPC:", 4, 4 + 16 + 16],
        ["Falo", 4 + 121 - 24, 4 + 16 + 16],
        ["Hint", 4, 4 + 16 + 32],
    ], "the title is centred in the inner width, the right text is right-aligned, baselines a line height down");
    assert.equal(texts[3].color, Color.YELLOW.getRGB() >>> 0);
    const shadows = g.strings.filter((s) => s.color === (Color.BLACK.getRGB() >>> 0));
    assert.equal(shadows.length, 4, "each text gets a black shadow at (+1, +1)");
    assert.deepEqual([shadows[0].x, shadows[0].y], [texts[0].x + 1, texts[0].y + 1]);
}

// --- A long line wraps into the inner width -------------------------------------------------------
{
    const g = new RecordingGraphics2D(font);
    const line = LineComponent.builder().left("Talk to the man standing by the gate").build();
    line.setPreferredSize({ width: 121, height: 0 });
    const size = line.render(g);
    assert.equal(size.height, 32, "two rows: 36 characters do not fit 121 px");
    const texts = g.strings.filter((s) => s.color !== (Color.BLACK.getRGB() >>> 0)).map((s) => s.text);
    // Greedy by words: "Talk to the man" is 90 px, adding " standing" (54 px) would pass 121.
    assert.deepEqual(texts, ["Talk to the man", "standing by the gate"]);
}

// --- A right-hand value shares the width 2:1 when the line wraps ------------------------------------
{
    const g = new RecordingGraphics2D(font);
    const line = LineComponent.builder().left("A very long requirement name here").right("x 1,000").build();
    line.setPreferredSize({ width: 121, height: 0 });
    line.render(g);
    // The right third is 40 px, so "x 1,000" (42 px) wraps too; each row keeps the right edge.
    const rows = g.strings.filter((s) => s.color !== (Color.BLACK.getRGB() >>> 0));
    const x = rows.find((s) => s.text === "x")!, amount = rows.find((s) => s.text === "1,000")!;
    assert.equal(x.x, 121 - 6, "the right text keeps its right edge");
    assert.equal(amount.x, 121 - 30);
    assert.equal(amount.y, x.y + 16, "on the next row");
}

// --- Hoverable areas and polygons ------------------------------------------------------------------
{
    const g = new RecordingGraphics2D(font);
    const area = new Rectangle(10, 10, 20, 20);
    OverlayUtil.renderHoverableArea(g, area, { x: 15, y: 15 }, new Color(0, 255, 0, 20), Color.ORANGE, Color.ORANGE.darker());
    assert.equal(g.shapes[0].kind, "draw");
    assert.equal(g.shapes[0].color, Color.ORANGE.darker().getRGB() >>> 0, "the mouse is inside: hover border");
    assert.equal(g.shapes[1].kind, "fill");
    assert.equal(g.shapes[1].color, new Color(0, 255, 0, 20).getRGB() >>> 0);
    OverlayUtil.renderHoverableArea(g, area, { x: 50, y: 50 }, new Color(0, 255, 0, 20), Color.ORANGE, Color.ORANGE.darker());
    assert.equal(g.shapes[2].color, Color.ORANGE.getRGB() >>> 0, "the mouse is outside: plain border");

    const poly = new Polygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
    assert.ok(poly.contains(5, 5));
    assert.ok(!poly.contains(15, 5));
    OverlayUtil.renderPolygon(g, poly, Color.CYAN);
    const drawn = g.shapes.slice(-2);
    assert.equal(drawn[0].kind, "draw");
    assert.equal(drawn[0].strokeWidth, 2, "RuneLite's default BasicStroke(2)");
    assert.equal(drawn[0].color, Color.CYAN.getRGB() >>> 0);
    assert.equal(drawn[1].kind, "fill");
    assert.equal(drawn[1].color, new Color(0, 0, 0, 50).getRGB() >>> 0, "RuneLite's default fill");
}

// --- Textures for drawn canvases are bounded, oldest first ------------------------------------------
{
    const created: string[] = [];
    const deleted: string[] = [];
    const textures = new Map<string, object>();
    const glr: any = {
        getTexture: (key: string) => textures.get(key),
        createTextureFromCanvas: (key: string, _canvas: HTMLCanvasElement) => {
            const texture = { key };
            textures.set(key, texture);
            created.push(key);
            return texture;
        },
        deleteTexture: (key: string) => {
            deleted.push(key);
            return textures.delete(key);
        },
    };
    const cache = new CanvasTextureCache(3);
    const canvases = Array.from({ length: 5 }, (_, i) => ({ width: i + 1, height: 1 }) as HTMLCanvasElement);
    const first = cache.texture(glr, canvases[0]);
    assert.equal(cache.texture(glr, canvases[0]), first, "the same canvas reuses its texture");
    assert.equal(created.length, 1);
    cache.texture(glr, canvases[1]);
    cache.texture(glr, canvases[2]);
    assert.equal(deleted.length, 0, "three fit");
    cache.texture(glr, canvases[3]);
    assert.deepEqual(deleted, [created[0]], "a fourth evicts the oldest");
    assert.notEqual(cache.texture(glr, canvases[0]), first, "the evicted canvas gets a new texture");
    cache.clear(glr);
    assert.equal(textures.size, 0, "clear deletes every texture it made");
}

// --- A panel overlay renders its content twice a frame: once for the signature, once to draw ---------
{
    let renders = 0;
    class CountingPanel extends OverlayPanel {
        constructor() {
            super("CountingPanel");
        }
        render(graphics: Graphics2D) {
            renders++;
            this.panelComponent.getChildren().push(TitleComponent.builder().text("Count").build());
            this.panelComponent.getChildren().push(LineComponent.builder().left("Left").right("Right").build());
            return super.render(graphics);
        }
    }
    const calls: string[] = [];
    const glr: any = {
        drawRect: () => calls.push("rect"),
        drawPolygon: () => calls.push("polygon"),
        drawPolyline: () => calls.push("polyline"),
        drawTexture: () => calls.push("texture"),
        getTexture: () => undefined,
        createTextureFromCanvas: () => ({}),
    };
    const context: any = {
        renderer: glr,
        fontLoader: () => undefined,
        sprite: () => undefined,
        place: () => ({ x: 10, y: 20, scaleX: 1, scaleY: 1 }),
    };
    const panel = new CountingPanel();
    panel.signature();
    assert.equal(renders, 1);
    const rects = panel.draw(context);
    assert.equal(renders, 2, "draw renders once and replays the recording at the placement");
    assert.equal(rects.length, 1);
    assert.deepEqual([rects[0].x, rects[0].y], [10, 20]);
    assert.ok(calls.includes("polygon"), "the background fill reached the renderer");
}

console.log("runelite-overlay-components: ok");

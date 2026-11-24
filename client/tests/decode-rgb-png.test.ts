import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

import { decodeRgbPng } from "../rs/map/decodeRgbPng";

function chunk(type: string, data: Uint8Array): Buffer {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    return out; // The decoder doesn't check CRCs, so they stay zero.
}

/** An 8-bit RGB PNG of `pixels` (0xRRGGBB), row y filtered with filters[y % filters.length]. */
function encode(width: number, height: number, pixels: number[], filters: number[], colorType = 2): Uint8Array {
    const stride = width * 3;
    const raw = Buffer.alloc((stride + 1) * height);
    const row = (y: number) => {
        const out = new Uint8Array(stride);
        for (let x = 0; x < width; x++) {
            const p = pixels[y * width + x];
            out.set([(p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff], x * 3);
        }
        return out;
    };
    for (let y = 0; y < height; y++) {
        const filter = filters[y % filters.length];
        const cur = row(y);
        const prev = y > 0 ? row(y - 1) : new Uint8Array(stride);
        raw[y * (stride + 1)] = filter;
        for (let i = 0; i < stride; i++) {
            const a = i >= 3 ? cur[i - 3] : 0;
            const b = prev[i];
            const c = i >= 3 ? prev[i - 3] : 0;
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
            raw[y * (stride + 1) + 1 + i] = (cur[i] - predictor) & 0xff;
        }
    }
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, height);
    ihdr.set([8, colorType, 0, 0, 0], 8);
    const compressed = deflateSync(raw);
    // Split the image data over two IDAT chunks, as encoders may.
    const half = compressed.length >> 1;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", compressed.subarray(0, half)),
        chunk("IDAT", compressed.subarray(half)),
        chunk("IEND", new Uint8Array(0)),
    ]);
}

const pixels = Array.from({ length: 64 * 64 }, (_, i) => ((i * 2654435761) >>> 8) & 0xffffff);

test("every scanline filter decodes back to the pixels encoded", () => {
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
        const png = decodeRgbPng(encode(64, 64, pixels, filters));
        assert.ok(png, `filters ${filters}`);
        assert.equal(png.width, 64);
        assert.equal(png.height, 64);
        assert.deepEqual([...png.rgb], pixels, `filters ${filters}`);
    }
});

test("formats other than 8-bit RGB fall back to the browser decoder", () => {
    assert.equal(decodeRgbPng(encode(4, 4, pixels.slice(0, 16), [0], 6)), undefined, "RGBA");
    assert.equal(decodeRgbPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])), undefined, "JPEG");
    const broken = encode(64, 64, pixels, [0]);
    assert.equal(decodeRgbPng(broken.subarray(0, broken.length - 40)), undefined, "truncated");
});

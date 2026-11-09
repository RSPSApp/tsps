const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const modulePath = require.resolve("../rs/io/ByteBuffer.js");
const floatPath = require.resolve("../common/utils/FloatUtil.js");
const { ByteBuffer } = require(modulePath);

test("actual JS and its pure FloatUtil dependency are selected", () => {
    assert.equal(modulePath, path.resolve(__dirname, "../rs/io/ByteBuffer.js"));
    assert.equal(floatPath, path.resolve(__dirname, "../common/utils/FloatUtil.js"));
    assert.ok(require.cache[modulePath].children.some(child => child.filename === floatPath));
});

test("JS signed subview read preserves backing", () => {
    const backing = new Int8Array([10, 20, -30, 40, 50]);
    const buffer = new ByteBuffer(backing.subarray(1, 4));
    buffer.offset = 1;
    const bytes = buffer.readBytes(2);
    assert.deepEqual(Array.from(bytes), [-30, 40]);
    assert.equal(buffer.offset, 3); assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31; assert.equal(backing[2], 31);
});

test("JS unsigned zero-offset control", () => {
    const backing = new Int8Array([10, -30, 40]);
    const buffer = new ByteBuffer(backing); buffer.offset = 1;
    const bytes = buffer.readUnsignedBytes(2);
    assert.deepEqual(Array.from(bytes), [226, 40]);
    assert.equal(buffer.offset, 3); assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31; assert.equal(backing[1], 31);
});

test("JS unsigned read respects signed input subview", () => {
    const backing = new Int8Array([10, 20, -30, 40, 50]);
    const buffer = new ByteBuffer(backing.subarray(1, 4)); buffer.offset = 1;
    const bytes = buffer.readUnsignedBytes(2);
    assert.deepEqual(Array.from(bytes), [226, 40]);
    assert.equal(buffer.offset, 3); assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, backing.buffer);
    bytes[0] = 31; assert.equal(backing[2], 31);
});

test("JS unsigned input is copied by its existing constructor", () => {
    const backing = new Uint8Array([10, 20, 226, 40, 50]);
    const buffer = new ByteBuffer(backing.subarray(1, 4)); buffer.offset = 1;
    assert.notEqual(buffer.data.buffer, backing.buffer);
    const bytes = buffer.readUnsignedBytes(2);
    assert.deepEqual(Array.from(bytes), [226, 40]);
    assert.equal(buffer.offset, 3); assert.equal(buffer.remaining, 0);
    assert.equal(bytes.buffer, buffer.data.buffer);
    bytes[0] = 31; assert.equal(buffer.data[1], 31); assert.equal(backing[2], 226);
});

test("JS and TS ByteBuffer expose the same reads (webpack resolves the .js first)", () => {
    const ts = require("node:fs").readFileSync(path.resolve(__dirname, "../rs/io/ByteBuffer.ts"), "utf8");
    for (const [, name] of ts.matchAll(/^    (read\w+)\(/gm)) {
        assert.equal(typeof ByteBuffer.prototype[name], "function", name + " missing from ByteBuffer.js");
    }
    const buffer = new ByteBuffer(new Int8Array([-1, -1, -1, 0x00, 0x24, 0x1b]));
    assert.equal(buffer.readSignedMedium(), -1);
    assert.equal(buffer.readSignedMedium(), 0x241b);
});

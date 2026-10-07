// Dumps the components of one IF3 interface group straight from the active OSRS cache.
// Port of xrsps-typescript's WidgetLoader.decodeIf3, kept minimal: enough to see the shape,
// text, sprites and scripts of every child.
//
//   yarn dump:widget <groupId>        # e.g. yarn dump:widget 90
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
//
// OUTPUT
// One line per component that carries anything worth seeing:
//
//   43: type=0 parent=2
//   47: type=5 sprite=1047 parent=45
//   50: type=4 parent=44 onTimer=[388,-2147483645] onVarTransmit=[388,-2147483645]
//
//   fileId  The component's id within the group. The server addresses it by PACKED UID:
//           (groupId << 16) | fileId. Component 43 of group 90 is (90 << 16) | 43, which is
//           what sendString / sendInterfaceDisplayState / sendSubInterface expect.
//   type    0 layer (container), 3 rectangle, 4 text, 5 graphic (sprite), 6 model, 9 line.
//   parent  fileId this component hangs off, "-" for a root. Hiding a component hides its
//           whole subtree, so pick the ancestor when you want a block gone.
//   hidden  Present when the component starts hidden in the cache.
//   on*     [scriptId, ...args] - the cache's own CS2 code. Large int args are packed
//           component uids (decode as above). Disassemble a script with:
//               yarn dump:cs2 <scriptId>
//
// BEFORE WRITING TO A COMPONENT FROM THE SERVER
// Check its listeners, and its ancestors' listeners, first. If a cache script sets the same
// text or hidden flag on a timer or var transmit, it will overwrite whatever the server
// sends, usually within a tick. Two ways out: feed the varp/varbit the script reads and let
// it render (the faithful option), or target a component no script touches.
//
// FINDING A GROUP ID
// RuneLite's generated names are the fastest map from feature to id:
// runelite-api/src/main/java/net/runelite/api/gameval/InterfaceID.java - e.g.
// CASTLEWARS_STATUS_OVERLAY_SARADOMIN = 58, plus a nested class naming every component.
// Ids move between revisions, so confirm against this cache with this script. Failing that,
// grep the interface index for a known string from the interface.
//
// The ids in older RSPS code (11146, 11479, 197, ...) are 317-era and do not exist here.
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";

function readListener(buf: ByteBuffer): any[] | null {
    const count = buf.readUnsignedByte();
    if (count === 0) return null;
    const args: any[] = new Array(count);
    for (let i = 0; i < count; i++) {
        const type = buf.readUnsignedByte();
        args[i] = type === 0 ? buf.readInt() : buf.readString();
    }
    return args;
}

function readTriggers(buf: ByteBuffer): number[] | null {
    const count = buf.readUnsignedByte();
    if (count === 0) return null;
    const triggers: number[] = new Array(count);
    for (let i = 0; i < count; i++) triggers[i] = buf.readInt();
    return triggers;
}

function decodeIf3(uid: number, data: Int8Array, revision: number): any {
    const buf = new ByteBuffer(data);
    buf.readByte();
    const type = buf.readByte();
    const contentType = buf.readUnsignedShort();
    buf.readShort(); buf.readShort();
    buf.readUnsignedShort();
    type === 9 ? buf.readShort() : buf.readUnsignedShort();
    const widthMode = buf.readByte();
    const heightMode = buf.readByte();
    buf.readByte(); buf.readByte();
    let parentId = buf.readUnsignedShort();
    const hidden = buf.readUnsignedByte() === 1;

    const w: any = { uid, type, contentType, parentId, hidden };

    if (type === 0) {
        buf.readUnsignedShort(); buf.readUnsignedShort();
        buf.readUnsignedByte();
    } else if (type === 5) {
        w.spriteId = buf.readInt(); buf.readUnsignedShort(); buf.readUnsignedByte();
        buf.readUnsignedByte(); buf.readUnsignedByte(); buf.readInt();
        buf.readUnsignedByte(); buf.readUnsignedByte();
    } else if (type === 6) {
        // Model IDs widened in cache 237; the wrong width also shifts flags/actions.
        if (revision >= 237) buf.readInt();
        else buf.readUnsignedShort();
        buf.readShort(); buf.readShort();
        buf.readUnsignedShort(); buf.readUnsignedShort(); buf.readUnsignedShort(); buf.readUnsignedShort();
        buf.readUnsignedShort();
        buf.readUnsignedByte();
        buf.readUnsignedShort();
        if (widthMode !== 0) buf.readUnsignedShort();
        if (heightMode !== 0) buf.readUnsignedShort();
    } else if (type === 4) {
        buf.readUnsignedShort();
        w.text = buf.readString();
        buf.readUnsignedByte(); buf.readUnsignedByte(); buf.readUnsignedByte();
        buf.readUnsignedByte();
        buf.readInt();
    } else if (type === 3) {
        buf.readInt(); buf.readUnsignedByte(); buf.readUnsignedByte();
    } else if (type === 9) {
        buf.readUnsignedByte(); buf.readInt(); buf.readUnsignedByte();
    }

    w.flags = buf.readMedium();
    w.dataText = buf.readString();
    const actionCount = buf.readUnsignedByte();
    if (actionCount > 0) {
        w.actions = [];
        for (let i = 0; i < actionCount; i++) w.actions.push(buf.readString());
    }
    buf.readUnsignedByte(); buf.readUnsignedByte(); buf.readUnsignedByte();
    w.spellActionName = buf.readString();

    w.onLoad = readListener(buf);
    w.onMouseOver = readListener(buf);
    w.onMouseLeave = readListener(buf);
    w.onTargetLeave = readListener(buf);
    w.onTargetEnter = readListener(buf);
    w.onVarTransmit = readListener(buf);
    w.onInvTransmit = readListener(buf);
    w.onStatTransmit = readListener(buf);
    w.onTimer = readListener(buf);
    w.onOp = readListener(buf);
    w.onMouseRepeat = readListener(buf);
    w.onClick = readListener(buf);
    w.onClickRepeat = readListener(buf);
    w.onRelease = readListener(buf);
    w.onHold = readListener(buf);
    w.onDrag = readListener(buf);
    w.onDragComplete = readListener(buf);
    w.onScroll = readListener(buf);
    w.varTransmitTriggers = readTriggers(buf);
    w.invTransmitTriggers = readTriggers(buf);
    w.statTransmitTriggers = readTriggers(buf);

    return w;
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const groupId = Number(process.argv[2]);
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.interfaces, CachePipeline.getStore());
    const fileIds = index.getFileIds(groupId);
    if (!fileIds || fileIds.length === 0) {
        console.log(`group ${groupId} MISSING`);
        return;
    }
    for (const fileId of fileIds) {
        const file = index.getFile(groupId, fileId);
        if (!file) continue;
        const data = new Int8Array(file.data);
        if ((data[0] & 0xff) !== 0xff) {
            console.log(`${fileId}: IF1 format (skipped)`);
            continue;
        }
        try {
            const w = decodeIf3((groupId << 16) | fileId, data, CachePipeline.getActive().revision);
            const bits: string[] = [`type=${w.type}`];
            if (w.flags) bits.push(`flags=${w.flags}`);
            if (w.text) bits.push(`text=${JSON.stringify(w.text)}`);
            if (w.spriteId !== undefined) bits.push(`sprite=${w.spriteId}`);
            if (w.hidden) bits.push("hidden");
            bits.push(`parent=${w.parentId === 65535 ? "-" : w.parentId & 0xffff}`);
            if (w.actions) bits.push(`actions=${JSON.stringify(w.actions)}`);
            if (w.onOp) bits.push(`onOp=${JSON.stringify(w.onOp)}`);
            if (w.onClick) bits.push(`onClick=${JSON.stringify(w.onClick)}`);
            if (w.onTimer) bits.push(`onTimer=${JSON.stringify(w.onTimer)}`);
            if (w.onLoad) bits.push(`onLoad=${JSON.stringify(w.onLoad)}`);
            if (w.onVarTransmit) bits.push(`onVarTransmit=${JSON.stringify(w.onVarTransmit)}`);
            if (bits.length > 1 || w.type !== 0) console.log(`${fileId}: ${bits.join(" ")}`);
        } catch (e) {
            console.log(`${fileId}: DECODE ERROR ${(e as Error).message}`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });

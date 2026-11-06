package gateway.up

import gateway.tsps.TspsWriter

/**
 * tsps's loc, ground-item and targeted ops (ClientProtocol.ts `decodeClientPacket`), each with
 * its own field order and byte transforms. Ctrl bytes are read and ignored by tsps; 0 is sent.
 */
object WorldOps {
    private val LOC_OPCODES = intArrayOf(96, 28, 42, 38, 51)
    private val OBJ_OPCODES = intArrayOf(102, 43, 103, 56, 82)
    private const val EXAMINE_LOC = 85
    private const val EXAMINE_OBJ = 104
    private const val OPLOC_T = 2
    private const val OPLOC_U = 86
    private const val OPOBJ_T = 94
    private const val OPOBJ_U = 79
    private const val OPNPC_T = 75
    private const val OPNPC_U = 36
    private const val OPPLAYER_T = 32
    private const val OPPLAYER_U = 65
    private const val INVENTORY_USE_ON = 241
    private const val INVENTORY_MOVE = 242
    private const val USE_ON_INVENTORY = 4

    fun loc(op: Int, id: Int, x: Int, z: Int): ByteArray {
        val w = TspsWriter()
        when (op) {
            1 -> w.u16Add(x).u16le(z).u8Neg(0).u16AddLE(id)
            2 -> w.u16AddLE(x).u16AddLE(z).u8Sub(0).u16(id)
            3 -> w.u16le(z).u16le(id).u16AddLE(x).u8Sub(0)
            4 -> w.u16Add(x).u16le(id).u16Add(z).u8Neg(0)
            5 -> w.u16(x).u8Add(0).u16Add(z).u16Add(id)
            else -> throw IllegalArgumentException("loc op $op")
        }
        return w.fixed(LOC_OPCODES[op - 1])
    }

    fun examineLoc(id: Int): ByteArray = TspsWriter().u16AddLE(id).fixed(EXAMINE_LOC)

    fun obj(op: Int, id: Int, x: Int, z: Int): ByteArray {
        val w = TspsWriter()
        when (op) {
            1 -> w.u8Sub(0).u16le(z).u16Add(id).u16Add(x)
            2 -> w.u16Add(x).u16le(z).u16(id).u8(0)
            3 -> w.u16le(id).u16Add(x).u16AddLE(z).u8Sub(0)
            4 -> w.u16AddLE(id).u16AddLE(z).u8Neg(0).u16Add(x)
            5 -> w.u16Add(id).u16le(x).u16le(z).u8Sub(0)
            else -> throw IllegalArgumentException("obj op $op")
        }
        return w.fixed(OBJ_OPCODES[op - 1])
    }

    fun examineObj(id: Int, x: Int, z: Int): ByteArray = TspsWriter().u16(id).u16le(z).u16le(x).fixed(EXAMINE_OBJ)

    /** A spell (or other component) on a loc. */
    fun spellOnLoc(id: Int, x: Int, z: Int, component: Int, sub: Int, obj: Int): ByteArray =
        TspsWriter().u16AddLE(z).u16Add(id).u16Add(sub).i32le(component).u16(x).u16le(obj).u8Neg(0).fixed(OPLOC_T)

    fun itemOnLoc(id: Int, x: Int, z: Int, component: Int, slot: Int, item: Int): ByteArray =
        TspsWriter().u16AddLE(slot).u16Add(id).i32le(component).u8Sub(0).u16le(x).u16(z).u16AddLE(item).fixed(OPLOC_U)

    fun spellOnObj(id: Int, x: Int, z: Int, component: Int, sub: Int, obj: Int): ByteArray =
        TspsWriter().i32le(component).u16Add(sub).u16Add(id).u16AddLE(x).u16(z).u8(0).u16AddLE(obj).fixed(OPOBJ_T)

    fun itemOnObj(id: Int, x: Int, z: Int, component: Int, slot: Int, item: Int): ByteArray =
        TspsWriter().u16AddLE(id).u16Add(z).i32me(component).u16Add(x).u16AddLE(slot).u8Sub(0).u16le(item).fixed(OPOBJ_U)

    fun spellOnNpc(index: Int, component: Int, sub: Int, obj: Int): ByteArray =
        TspsWriter().u16(index).i32le(component).u16(sub).u16Add(obj).u8Add(0).fixed(OPNPC_T)

    fun itemOnNpc(index: Int, component: Int, slot: Int, item: Int): ByteArray =
        TspsWriter().u16AddLE(slot).u8(0).i32me(component).u16le(item).u16AddLE(index).fixed(OPNPC_U)

    fun spellOnPlayer(index: Int, component: Int, sub: Int, obj: Int): ByteArray =
        TspsWriter().u8Neg(0).u16le(obj).u16le(sub).i32ime(component).u16le(index).fixed(OPPLAYER_T)

    fun itemOnPlayer(index: Int, component: Int, slot: Int, item: Int): ByteArray =
        TspsWriter().u16AddLE(index).u16AddLE(item).u16Add(slot).i32(component).u8Add(0).fixed(OPPLAYER_U)

    private val WORLD_ENTITY_OPCODES = intArrayOf(220, 221, 222, 223, 224)
    private const val WORLD_MAP_CLICK = 105
    private const val TELEPORT = 212

    /** OPWORLDENTITY1-5: a boat's ops. */
    fun worldEntity(op: Int, index: Int): ByteArray {
        val w = TspsWriter()
        when (op) {
            1 -> w.u16le(index).u8Sub(0)
            2 -> w.u16Add(index).u8Add(0)
            3 -> w.u16(index).u8Neg(0)
            4 -> w.u8Sub(0).u16(index)
            5 -> w.u8Add(0).u16le(index)
            else -> throw IllegalArgumentException("world entity op $op")
        }
        return w.fixed(WORLD_ENTITY_OPCODES[op - 1])
    }

    /** A world-map click (a developer teleport in tsps): i32 `level << 28 | x << 14 | z` as intIME. */
    fun worldMapClick(level: Int, x: Int, z: Int): ByteArray = TspsWriter().i32ime((level shl 28) or (x shl 14) or z).fixed(WORLD_MAP_CLICK)

    fun teleport(level: Int, x: Int, z: Int): ByteArray = TspsWriter().u16(x).u16(z).u8(level).fixed(TELEPORT)

    /** The browser's own packet for dragging an inventory item onto another slot. */
    fun inventoryMove(from: Int, to: Int): ByteArray = TspsWriter().u16(from).u16(to).fixed(INVENTORY_MOVE)

    /** The browser's own packet for using an inventory item on another. */
    fun itemOnItem(slot: Int, item: Int, targetSlot: Int, targetItem: Int): ByteArray =
        TspsWriter()
            .u16(slot)
            .u16(item)
            .u8(USE_ON_INVENTORY)
            .u16(0)
            .u8(0) // no tile
            .u8(0) // level
            .u16(targetSlot)
            .u16(targetItem)
            .varByte(INVENTORY_USE_ON)
}

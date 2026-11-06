package gateway.down

/**
 * tsps's player and NPC update blocks (`writePlayerUpdateBlock` / `writeNpcUpdateBlock` in
 * ClientProtocol.ts), decoded field by field with their byte transforms undone.
 */
class ActorBlock {
    var forcedChat: String? = null
    var faceDirection: Int? = null

    /** NPC index, or player index + 0x10000; -1 clears. */
    var faceEntity: Int? = null
    var animation: Pair<Int, Int>? = null
    val hits = ArrayList<Hit>()
    val headbars = ArrayList<Headbar>()
    var movementType: Int? = null
    var appearance: AppearanceBlock? = null
    var exactMove: ExactMove? = null
    var resetPath = false
    val spotAnims = ArrayList<SpotAnim>()
    var tint: Tint? = null
    var faceTile: Pair<Int, Int>? = null
    var headIcons: List<Pair<Int, Int>>? = null
    var modelCustomisation: List<Pair<Int, Int>>? = null
    var baseAnimations: List<Pair<Int, Int>>? = null
    var transparency: Transparency? = null

    class Hit(val type: Int, val damage: Int, val delay: Int)

    class Headbar(val id: Int, val remove: Boolean, val duration: Int, val delay: Int, val fill: Int, val endFill: Int)

    class SpotAnim(val slot: Int, val id: Int, val height: Int, val delay: Int)

    class ExactMove(val startX: Int, val startZ: Int, val endX: Int, val endZ: Int, val startCycle: Int, val endCycle: Int, val direction: Int)

    class Tint(val start: Int, val end: Int, val hue: Int, val saturation: Int, val lightness: Int, val weight: Int)

    class Transparency(val start: Int, val end: Int, val from: Int, val to: Int)
}

/** The appearance tsps builds in `encodePlayerAppearance`. */
class AppearanceBlock(
    val gender: Int,
    val skull: Int,
    val prayer: Int,
    val npcId: Int,
    /** Per worn slot: an obj id, or -1. */
    val objs: IntArray,
    /** Per worn slot: an identkit id, or -1. */
    val kits: IntArray,
    val colours: IntArray,
    /** ready, turn, walk, walk back, walk left, walk right, run; -1 for none. */
    val animations: IntArray,
    val name: String,
    val combatLevel: Int,
    val skillLevel: Int,
    /** The ammo slot's quantity and obj, and the ring, which tsps adds after the appearance proper. */
    val ammoQuantity: Int,
    val ammo: Int,
    val ring: Int,
)

object ActorBlocks {
    private const val PLAYER_FORCED_CHAT = 0x01
    private const val PLAYER_FACE_DIR = 0x02
    private const val PLAYER_APPEARANCE = 0x04
    private const val PLAYER_ANIMATION = 0x08
    private const val PLAYER_HIT = 0x20
    private const val PLAYER_FACE_ENTITY = 0x40
    private const val PLAYER_TINT = 0x200
    private const val PLAYER_FORCE_MOVEMENT = 0x400
    private const val PLAYER_MOVEMENT_TYPE = 0x1000
    private const val PLAYER_MOVEMENT_FLAG = 0x2000
    private const val PLAYER_SPOT_ANIM = 0x10000

    private const val NPC_FACE_ENTITY = 0x08
    private const val NPC_ANIMATION = 0x10
    private const val NPC_HIT = 0x20
    private const val NPC_FORCED_CHAT = 0x40
    private const val NPC_TINT = 0x100
    private const val NPC_HEAD_ICONS = 0x200
    private const val NPC_EXACT_MOVE = 0x400
    private const val NPC_FACE_TILE = 0x800
    private const val NPC_MODEL_CUSTOMISATION = 0x1000
    private const val NPC_BASE_ANIMATIONS = 0x2000
    private const val NPC_TRANSPARENCY = 0x8000
    private const val NPC_SPOT_ANIM = 0x20000

    private const val HEADBAR_REMOVE = 32767
    private const val NO_ENTITY = 0xFFFFFF

    fun player(reader: BlockReader): ActorBlock {
        val block = ActorBlock()
        val mask = reader.mask()
        if (mask and PLAYER_FORCED_CHAT != 0) block.forcedChat = reader.string()
        if (mask and PLAYER_FACE_DIR != 0) block.faceDirection = reader.u16le() and 2047
        if (mask and PLAYER_FACE_ENTITY != 0) {
            val low = reader.u16()
            val target = (reader.u8() shl 16) or low
            block.faceEntity = if (target == NO_ENTITY) -1 else target
        }
        if (mask and PLAYER_ANIMATION != 0) block.animation = reader.u16leA().noneAsMinusOne() to reader.u8()
        if (mask and PLAYER_HIT != 0) hits(reader, block, npc = false)
        if (mask and PLAYER_MOVEMENT_TYPE != 0) block.movementType = reader.u8c()
        if (mask and PLAYER_APPEARANCE != 0) {
            val length = reader.u8c()
            block.appearance = appearance(BlockReader(reader.bytes(length)))
        }
        if (mask and PLAYER_FORCE_MOVEMENT != 0) block.exactMove = exactMove(reader)
        if (mask and PLAYER_MOVEMENT_FLAG != 0) {
            reader.u8s()
            block.resetPath = true
        }
        if (mask and PLAYER_SPOT_ANIM != 0) {
            repeat(reader.u8a()) {
                val slot = reader.u8()
                val id = reader.u16().noneAsMinusOne()
                val packed = reader.intME()
                block.spotAnims += ActorBlock.SpotAnim(slot, id, packed ushr 16, packed and 0xFFFF)
            }
        }
        if (mask and PLAYER_TINT != 0) {
            block.tint = ActorBlock.Tint(reader.u16le(), reader.u16le(), reader.u8s(), reader.u8(), reader.u8a(), reader.u8c())
        }
        return block
    }

    internal fun npcTint(reader: BlockReader) = ActorBlock.Tint(reader.u16a(), reader.u16a(), reader.u8c(), reader.u8s(), reader.u8c(), reader.u8s())

    fun npc(reader: BlockReader): ActorBlock {
        val block = ActorBlock()
        val mask = reader.mask()
        if (mask and NPC_FACE_ENTITY != 0) {
            val low = reader.u16leA()
            val target = (reader.u8a() shl 16) or low
            block.faceEntity = if (target == NO_ENTITY) -1 else target
        }
        if (mask and NPC_HIT != 0) hits(reader, block, npc = true)
        if (mask and NPC_FORCED_CHAT != 0) block.forcedChat = reader.string()
        // The player tint's fields, in the NPC block's own byte order.
        if (mask and NPC_TINT != 0) block.tint = npcTint(reader)
        if (mask and NPC_SPOT_ANIM != 0) {
            repeat(reader.u8()) {
                val slot = reader.u8a()
                val id = reader.u16le().noneAsMinusOne()
                val packed = reader.intME()
                block.spotAnims += ActorBlock.SpotAnim(slot, id, packed ushr 16, packed and 0xFFFF)
            }
        }
        if (mask and NPC_ANIMATION != 0) block.animation = reader.u16().noneAsMinusOne() to reader.u8()
        if (mask and NPC_HEAD_ICONS != 0) block.headIcons = List(reader.u8()) { reader.u16() to reader.u8() }
        if (mask and NPC_EXACT_MOVE != 0) block.exactMove = exactMove(reader)
        if (mask and NPC_FACE_TILE != 0) block.faceTile = reader.u16() to reader.u16()
        if (mask and NPC_MODEL_CUSTOMISATION != 0) block.modelCustomisation = List(reader.u8()) { reader.u8() to reader.u16le() }
        if (mask and NPC_BASE_ANIMATIONS != 0) block.baseAnimations = List(reader.u8()) { reader.u8() to reader.u16().noneAsMinusOne() }
        if (mask and NPC_TRANSPARENCY != 0) {
            block.transparency = ActorBlock.Transparency(reader.u16(), reader.u16(), reader.u16().noneAsMinusOne(), reader.u8())
        }
        return block
    }

    private fun hits(reader: BlockReader, block: ActorBlock, npc: Boolean) {
        val hitCount = if (npc) reader.u8s() else reader.u8c()
        repeat(hitCount) { block.hits += ActorBlock.Hit(reader.smart(), reader.smart(), reader.smart()) }
        val barCount = if (npc) reader.u8a() else reader.u8c()
        repeat(barCount) {
            val id = reader.smart()
            val duration = reader.smart()
            if (duration == HEADBAR_REMOVE) {
                block.headbars += ActorBlock.Headbar(id, true, 0, 0, 0, 0)
                return@repeat
            }
            val delay = reader.smart()
            val fill = if (npc) reader.u8c() else reader.u8()
            val endFill = if (duration > 0) reader.u8s() else fill
            block.headbars += ActorBlock.Headbar(id, false, duration, delay, fill, endFill)
        }
    }

    private fun exactMove(reader: BlockReader) =
        ActorBlock.ExactMove(
            startX = reader.u8s().toByte().toInt(),
            startZ = reader.u8().toByte().toInt(),
            endX = reader.u8().toByte().toInt(),
            endZ = reader.u8a().toByte().toInt(),
            startCycle = reader.u16a(),
            endCycle = reader.u16(),
            direction = reader.u16leA() and 2047,
        )

    internal fun appearance(reader: BlockReader): AppearanceBlock {
        val gender = reader.u8()
        val skull = reader.u8().let { if (it == 0xFF) -1 else it }
        val prayer = reader.u8().let { if (it == 0xFF) -1 else it }
        val objs = IntArray(WORN_SLOTS) { -1 }
        val kits = IntArray(WORN_SLOTS) { -1 }
        var npcId = -1
        if (reader.peek() == 0xFF && reader.peek(1) == 0xFF) {
            reader.u16()
            npcId = reader.u16()
        } else {
            // tsps writes the slots twice; the second copy repeats the first.
            repeat(2) { copy ->
                for (slot in 0 until WORN_SLOTS) {
                    if (reader.peek() == 0) {
                        reader.u8()
                        continue
                    }
                    val value = reader.u16()
                    if (copy > 0) continue
                    if (value >= OBJ_OFFSET) objs[slot] = value - OBJ_OFFSET else kits[slot] = value - KIT_OFFSET
                }
            }
        }
        val colours = IntArray(5) { reader.u8() }
        val animations = IntArray(7) { reader.u16().noneAsMinusOne() }
        val name = reader.string()
        val combatLevel = reader.u8()
        val skillLevel = reader.u16()
        reader.u8() // hidden
        reader.u16() // obj recolour/retexture overrides
        repeat(3) { reader.string() } // name extras
        reader.u8()
        val ammoQuantity = if (reader.remaining >= 4) reader.i32() else 0
        val ammo = if (reader.remaining >= 4) reader.i32() else -1
        val ring = if (reader.remaining >= 4) reader.i32() else -1
        return AppearanceBlock(gender, skull, prayer, npcId, objs, kits, colours, animations, name, combatLevel, skillLevel, ammoQuantity, ammo, ring)
    }

    private fun Int.noneAsMinusOne() = if (this == 0xFFFF) -1 else this

    private const val WORN_SLOTS = 12
    private const val OBJ_OFFSET = 2048
    private const val KIT_OFFSET = 256
}

/** A byte reader with tsps's (OSRS-named) byte transforms. */
class BlockReader(private val data: ByteArray, var offset: Int = 0) {
    val remaining: Int get() = data.size - offset

    fun peek(ahead: Int = 0) = data[offset + ahead].toInt() and 0xFF

    fun u8() = data[offset++].toInt() and 0xFF

    /** `byteA`: value + 128. */
    fun u8a() = (u8() - 128) and 0xFF

    /** `byteC`: -value. */
    fun u8c() = (-u8()) and 0xFF

    /** `byteS`: 128 - value. */
    fun u8s() = (128 - u8()) and 0xFF

    fun u16() = (u8() shl 8) or u8()

    fun u16le() = u8() or (u8() shl 8)

    /** `shortLEA`: low byte + 128 first. */
    fun u16leA() = ((u8() - 128) and 0xFF) or (u8() shl 8)

    /** `shortBEA`: high byte, then low byte + 128. */
    fun u16a() = (u8() shl 8) or ((u8() - 128) and 0xFF)

    fun i32() = (u16() shl 16) or u16()

    /** `intME`: bytes 2, 1, 4, 3 of the big-endian value. */
    fun intME(): Int {
        val b0 = u8()
        val b1 = u8()
        val b2 = u8()
        val b3 = u8()
        return (b2 shl 24) or (b3 shl 16) or (b0 shl 8) or b1
    }

    fun smart(): Int = if (peek() < 128) u8() else u16() - 32768

    fun string(): String {
        val start = offset
        while (data[offset] != 0.toByte()) offset++
        return String(data, start, offset++ - start, Charsets.ISO_8859_1)
    }

    fun bytes(length: Int): ByteArray = data.copyOfRange(offset, offset + length).also { offset += length }

    /** An update mask: one byte, a second when bit 0x80 is set, a third when 0x4000 is. */
    fun mask(): Int {
        var mask = u8()
        if (mask and 0x80 != 0) mask = mask or (u8() shl 8)
        if (mask and 0x4000 != 0) mask = mask or (u8() shl 16)
        return mask
    }
}

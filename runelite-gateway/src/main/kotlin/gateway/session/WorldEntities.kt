package gateway.session

import gateway.down.BitReader
import gateway.down.MapRebuild
import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import net.rsprot.protocol.game.outgoing.info.worldentityinfo.WorldEntityAvatar
import net.rsprot.protocol.game.outgoing.map.RebuildWorldEntityV4

/**
 * Boats: tsps's world entities, as rsprot world-entity avatars.
 *
 * tsps builds each boat's deck as an instance far off the map and keeps everyone and everything
 * on it at real coordinates there, which is also how rsprot places a world's contents. So the
 * deck scene, its locs and the actors on it only need their world; the boat itself is an avatar
 * moved by WORLDENTITY_INFO.
 */
class WorldEntities(private val world: EntityWorld) {
    /**
     * A boat's deck scene (REBUILD_WORLDENTITY): [zoneX], [zoneZ] is its south-west zone in the
     * instance, [sizeX] × [sizeZ] its size in zones, [zones] the 4 × 13 × 13 template references
     * of a scene centred on it.
     */
    class Deck(
        val index: Int,
        /** The boat's world in this session: tsps's index is above rsprot's world limit. */
        val worldId: Int,
        val configId: Int,
        val sizeX: Int,
        val sizeZ: Int,
        val zoneX: Int,
        val zoneZ: Int,
        private val zones: Array<Int?>,
    ) {
        val baseX: Int get() = zoneX shl 3
        val baseZ: Int get() = zoneZ shl 3

        fun contains(x: Int, z: Int): Boolean = x - baseX in 0 until (sizeX shl 3) && z - baseZ in 0 until (sizeZ shl 3)

        fun rebuild(): RebuildWorldEntityV4 =
            RebuildWorldEntityV4(baseX, baseZ, sizeX, sizeZ) { x, z, level ->
                zones[(level * SCENE_ZONES + (x - zoneX + SCENE_CENTRE)) * SCENE_ZONES + (z - zoneZ + SCENE_CENTRE)]?.let(MapRebuild::zone)
            }
    }

    private class Boat(val avatar: WorldEntityAvatar, var fineX: Int, var fineZ: Int, var angle: Int)

    private val decks = HashMap<Int, Deck>()
    private val boats = HashMap<Int, Boat>()

    /** tsps numbers boats 3000-3999; rsprot takes world ids below 2048, so each gets its own. */
    private val worldIds = HashMap<Int, Int>()

    /** The boats as the client has them listed; WORLDENTITY_INFO's updates come in this order. */
    private var order = ArrayList<Int>()

    /** By tsps's index. */
    fun deck(index: Int): Deck? = decks[index]

    /** By this session's world id. */
    fun deckOfWorld(worldId: Int): Deck? = decks.values.firstOrNull { it.worldId == worldId }

    /** This session's world id for a boat tsps names, or null when the client doesn't have it. */
    fun sessionWorld(index: Int): Int? = worldIds[index]

    /** tsps's index for a world id the client names (its world-entity ops). */
    fun tspsIndex(worldId: Int): Int? = worldIds.entries.firstOrNull { it.value == worldId }?.key

    private fun worldId(index: Int): Int =
        worldIds.getOrPut(index) { (1 until MAX_WORLDS).first { it !in worldIds.values } }

    /** The deck a tile is on, if any. */
    fun deckAt(x: Int, z: Int): Deck? = decks.values.firstOrNull { it.contains(x, z) }

    /**
     * `REBUILD_WORLDENTITY` (142): `u16 index, u16 config, u8 sizeX, u8 sizeZ` (tiles), `u16 zoneX,
     * u16 zoneZ, u16 zoneZ, u8 reload, u16 zoneX, u16 keyCount, u8 0`, then the scene's zones as
     * REBUILD_REGION has them.
     */
    fun onRebuild(packet: TspsPacket) {
        val reader = packet.reader()
        val index = reader.u16()
        val configId = reader.u16()
        val sizeX = zones(reader.u8())
        val sizeZ = zones(reader.u8())
        val zoneX = reader.u16()
        val zoneZ = reader.u16()
        reader.offset += 2 + 1 + 2 + 2 + 1
        val bits = BitReader(packet.payload, reader.offset)
        val scene = Array(LEVELS * SCENE_ZONES * SCENE_ZONES) { if (bits.read(1) == 1) bits.read(26) else null }
        decks[index] = Deck(index, worldId(index), configId, sizeX, sizeZ, zoneX, zoneZ, scene)
    }

    /**
     * `WORLDENTITY_INFO` (143): `u8 count`, then for each boat in [order] `u8 type` (0 gone,
     * 1 unchanged, 2 moved, 3 placed), a position delta for 2 and 3, and a mask byte unless gone;
     * then new boats to the end: `u16 index, u8 sizeX, u8 sizeZ, u16 config`, a position,
     * `u8 draw mode, u8 mask`. [level] is the level boats are drawn on: the player's.
     */
    fun onInfo(packet: TspsPacket, level: Int) {
        val reader = packet.reader()
        val count = reader.u8()
        val kept = ArrayList<Int>()
        for (index in order.take(count)) {
            val type = reader.u8()
            val boat = boats[index]
            if (type == GONE) {
                boats.remove(index)?.let { world.releaseWorldEntity(it.avatar) }
                decks.remove(index)
                worldIds.remove(index)
                continue
            }
            kept += index
            if (type >= MOVED) {
                val delta = position(reader)
                if (boat != null) {
                    boat.fineX += delta.x
                    boat.fineZ += delta.z
                    boat.angle = (boat.angle + delta.angle) and ANGLE_MASK
                    boat.avatar.updateCoord(level, boat.fineX, boat.fineZ, teleport = type == PLACED)
                    boat.avatar.updateAngle(boat.angle)
                }
            }
            reader.u8() // mask
        }
        while (reader.remaining > 0) {
            val index = reader.u16()
            reader.u8()
            reader.u8() // the size again, in tiles
            val configId = reader.u16()
            val at = position(reader)
            reader.u8() // draw mode
            reader.u8() // mask
            val deck = decks[index] ?: continue
            val avatar =
                world.allocWorldEntity(
                    deck.worldId,
                    configId,
                    deck.sizeX,
                    deck.sizeZ,
                    deck.zoneX,
                    deck.zoneZ,
                    level,
                    at.x,
                    at.z,
                    at.angle and ANGLE_MASK,
                )
            boats[index] = Boat(avatar, at.x, at.z, at.angle and ANGLE_MASK)
            kept += index
        }
        order = kept
    }

    fun release() {
        boats.values.forEach { world.releaseWorldEntity(it.avatar) }
        boats.clear()
        decks.clear()
        worldIds.clear()
        order.clear()
    }

    private class Position(val x: Int, val z: Int, val angle: Int)

    /** A flags byte (2 bits a value: absent, byte, short, int), then x, y, z and angle. */
    private fun position(reader: TspsReader): Position {
        val flags = reader.u8()
        val values =
            IntArray(4) { field ->
                when ((flags ushr (field * 2)) and 3) {
                    0 -> 0
                    1 -> reader.u8().toByte().toInt()
                    2 -> reader.s16()
                    else -> reader.i32()
                }
            }
        return Position(values[0], values[2], values[3])
    }

    private companion object {
        const val GONE = 0
        const val MAX_WORLDS = 2048
        const val MOVED = 2
        const val PLACED = 3
        const val ANGLE_MASK = 2047
        const val LEVELS = 4
        const val SCENE_ZONES = 13
        const val SCENE_CENTRE = 6

        fun zones(tiles: Int) = (tiles + 7) ushr 3
    }
}

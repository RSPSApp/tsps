package gateway.down

import gateway.tsps.TspsPacket
import net.rsprot.protocol.game.outgoing.map.RebuildNormalV2
import net.rsprot.protocol.game.outgoing.map.RebuildRegionV2
import net.rsprot.protocol.game.outgoing.map.util.RebuildRegionZone
import net.rsprot.protocol.message.OutgoingGameMessage

/** A tsps scene rebuild, centred on zone [zoneX], [zoneZ]. */
sealed class MapRebuild(val zoneX: Int, val zoneZ: Int) {
    abstract fun toMessage(): OutgoingGameMessage

    /**
     * Whether the scene the client already has ([current]) can stay instead of this one. tsps
     * rebuilds an instance's scene every zone or two a player moves; the official client reloads
     * the whole scene each time (the player seems to jump, or vanishes while it loads), where OSRS
     * rebuilds only near the scene's edge. A scene centred at most [KEEP_ZONES] zones away still
     * covers the player by more than that, as long as it shows the same map.
     */
    fun canKeep(current: MapRebuild?): Boolean =
        current != null &&
            current::class == this::class &&
            kotlin.math.abs(zoneX - current.zoneX) <= KEEP_ZONES &&
            kotlin.math.abs(zoneZ - current.zoneZ) <= KEEP_ZONES &&
            sameMapAs(current)

    protected open fun sameMapAs(current: MapRebuild): Boolean = true

    /** `REBUILD_NORMAL` (141): `u16 zoneX, u16 zoneZ, u8 keep, u16 keyCount, keys`. */
    class Normal(zoneX: Int, zoneZ: Int) : MapRebuild(zoneX, zoneZ) {
        override fun toMessage() = RebuildNormalV2(zoneX, zoneZ, MAIN_WORLD_AREA)
    }

    /**
     * `REBUILD_REGION` (140), a templated instance: `u16 zoneZ, u8 reload, u16 zoneX,
     * u16 keyCount`, then per level, x, z of the 13×13 scene a bit for "has a zone" and the
     * zone's 26-bit reference, packed as rsprot's ReferenceZone.
     */
    class Region(zoneX: Int, zoneZ: Int, private val reload: Boolean, private val zones: Array<Int?>) :
        MapRebuild(zoneX, zoneZ) {
        /** The template zone this scene copies to absolute zone [x], [z] on [level], or null outside it. */
        private fun zoneAt(level: Int, x: Int, z: Int): Int? {
            val sx = x - zoneX + 6
            val sz = z - zoneZ + 6
            if (sx !in 0 until SCENE_ZONES || sz !in 0 until SCENE_ZONES) return null
            return zones[(level * SCENE_ZONES + sx) * SCENE_ZONES + sz]
        }

        private fun inScene(x: Int, z: Int) = x - zoneX + 6 in 0 until SCENE_ZONES && z - zoneZ + 6 in 0 until SCENE_ZONES

        /** The same instance: every zone both scenes have is the same copy, and no reload was asked. */
        override fun sameMapAs(current: MapRebuild): Boolean {
            if (reload || current !is Region) return false
            for (level in 0 until LEVELS) {
                for (x in zoneX - 6..zoneX + 6) {
                    for (z in zoneZ - 6..zoneZ + 6) {
                        if (current.inScene(x, z) && zoneAt(level, x, z) != current.zoneAt(level, x, z)) return false
                    }
                }
            }
            return true
        }

        override fun toMessage() =
            RebuildRegionV2(zoneX, zoneZ, reload) { x, z, level ->
                zones[(level * SCENE_ZONES + (x - zoneX + 6)) * SCENE_ZONES + (z - zoneZ + 6)]?.let(::zone)
            }
    }

    companion object {
        /**
         * OSRS's world-area id: 0 is the main world, which live sends there. tsps has none to give;
         * -1 went out as 65535 (rsprot packs it unsigned), an area the client can't find.
         */
        const val MAIN_WORLD_AREA = 0

        /** How far (in zones) a new scene's centre may be from the client's for it to stay. */
        const val KEEP_ZONES = 3
        private const val SCENE_ZONES = 13
        private const val LEVELS = 4

        /** A template zone reference, packed as rsprot's ReferenceZone. */
        fun zone(packed: Int) =
            RebuildRegionZone((packed ushr 14) and 0x3FF, (packed ushr 3) and 0x7FF, (packed ushr 24) and 3, (packed ushr 1) and 3)

        fun normal(packet: TspsPacket): Normal {
            val reader = packet.reader()
            return Normal(reader.u16(), reader.u16())
        }

        fun region(packet: TspsPacket): Region {
            val reader = packet.reader()
            val zoneZ = reader.u16()
            val reload = reader.u8() != 0
            val zoneX = reader.u16()
            reader.u16() // key count; the keys follow the palette
            val bits = BitReader(packet.payload, reader.offset)
            val zones = Array(LEVELS * SCENE_ZONES * SCENE_ZONES) { if (bits.read(1) == 1) bits.read(26) else null }
            return Region(zoneX, zoneZ, reload, zones)
        }
    }
}

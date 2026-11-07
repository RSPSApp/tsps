package gateway.session

import gateway.cache.Cache
import gateway.cache.NpcTypes
import gateway.cache.ObjTypes
import gateway.config.GatewayConfig
import gateway.down.ActorBlock
import gateway.down.NpcSync
import io.netty.buffer.PooledByteBufAllocator
import io.netty.buffer.Unpooled
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatar
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatarExtendedInfo
import net.rsprot.protocol.internal.game.outgoing.info.npcinfo.extendedinfo.BaseAnimationSet
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** tsps's base animation block replaces the whole set; an empty one goes back to the type's (#2276). */
class BaseAnimationsTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)
    private val world =
        EntityWorld(
            PooledByteBufAllocator.DEFAULT,
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(cache.file(10, "huffman")!!))),
        )
    private val mirror = EntityMirror(world, ObjTypes(cache), NpcTypes(cache), world.allocPlayer(OBSERVER), OBSERVER, {})

    @Test
    fun `an empty set resets the overrides`() {
        val avatar = add()
        send(listOf(IDLE to FEEDING_IDLE))
        assertEquals(READY_BIT, avatar.baseAnimationSet().overrides)
        assertEquals(FEEDING_IDLE, avatar.baseAnimationSet().readyAnim.toInt())

        send(emptyList())
        assertEquals(0, avatar.baseAnimationSet().overrides)
    }

    @Test
    fun `a new set drops the slots it leaves out`() {
        val avatar = add()
        send(listOf(IDLE to FEEDING_IDLE, WALK to FEEDING_IDLE))
        send(listOf(WALK to FEEDING_IDLE))
        assertEquals(WALK_BIT, avatar.baseAnimationSet().overrides)
    }

    private fun add(): NpcAvatar {
        val npc = NpcSync.Npc(NPC_INDEX, SCURRIUS, 3298, 9870, 0)
        mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Added(NPC_INDEX, npc, 0, false)), emptyMap()), 0)
        @Suppress("UNCHECKED_CAST")
        val npcs = EntityMirror::class.java.getDeclaredField("npcs").apply { isAccessible = true }.get(mirror) as Map<Int, NpcAvatar>
        return npcs.getValue(NPC_INDEX)
    }

    private fun send(anims: List<Pair<Int, Int>>) =
        mirror.applyNpcs(NpcSync.Frame(emptyList(), mapOf(NPC_INDEX to ActorBlock().apply { baseAnimations = anims })), 0)

    /** rsprot keeps the set in a private block holder; read it the way its encoder does. */
    private fun NpcAvatar.baseAnimationSet(): BaseAnimationSet {
        val blocks = NpcAvatarExtendedInfo::class.java.getDeclaredField("blocks").apply { isAccessible = true }.get(extendedInfo)
        return blocks.javaClass.getMethod("getBaseAnimationSet").invoke(blocks) as BaseAnimationSet
    }

    private companion object {
        const val OBSERVER = 1
        const val NPC_INDEX = 10
        const val SCURRIUS = 7221
        const val IDLE = 0
        const val WALK = 1
        const val FEEDING_IDLE = 10689
        const val READY_BIT = 0x4000
        const val WALK_BIT = 0x4
    }
}

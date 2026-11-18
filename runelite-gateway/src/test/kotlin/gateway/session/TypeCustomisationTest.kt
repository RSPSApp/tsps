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
import net.rsprot.protocol.internal.game.outgoing.info.npcinfo.extendedinfo.TypeCustomisation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * tsps's type customisation (an Echo boss) reaches RuneLite as OSRS's body customisation, name
 * change and level change, as live sends an Echo (rsprox 1158/1161).
 */
class TypeCustomisationTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)
    private val npcTypes = NpcTypes(cache)
    private val world =
        EntityWorld(
            PooledByteBufAllocator.DEFAULT,
            DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(cache.file(10, "huffman")!!))),
        )
    private val mirror = EntityMirror(world, ObjTypes(cache), npcTypes, world.allocPlayer(OBSERVER), OBSERVER, {})

    @Test
    fun `an echo's models, name and level, with the type's recolours mapped to themselves`() {
        val avatar = add()
        val sources = npcTypes.recolourSources(DAGANNOTH_REX)
        assertEquals(4, sources.size, "Dagannoth Rex recolours four colours")
        send(ActorBlock.TypeCustomisation(listOf(60217, 60216), emptyList(), "Dagannoth Rex (Echo)", 454))
        val body = avatar.blocks().customisation()!!
        assertEquals(listOf(60217, 60216), body.models)
        assertEquals(sources, body.recolours, "every source keeps its own colour: the normal recolours are cleared")
        assertEquals("Dagannoth Rex (Echo)", avatar.blocks().field<String?>("getNameChange", "getName"))
        assertEquals(454, avatar.blocks().field<Int>("getCombatLevelChange", "getLevel"))
    }

    @Test
    fun `a named recolour pair sets that source's destination`() {
        val avatar = add()
        val sources = npcTypes.recolourSources(DAGANNOTH_REX)
        send(ActorBlock.TypeCustomisation(null, listOf(sources[1] to 1234), null, null))
        val body = avatar.blocks().customisation()!!
        assertEquals(npcTypes.models(DAGANNOTH_REX), body.models, "no model list keeps the type's")
        assertEquals(sources.mapIndexed { index, source -> if (index == 1) 1234 else source }, body.recolours)
    }

    @Test
    fun `a customisation without fields resets body, name and level`() {
        val avatar = add()
        send(ActorBlock.TypeCustomisation(listOf(60217), emptyList(), "Dagannoth Rex (Echo)", 454))
        send(ActorBlock.TypeCustomisation(null, null, null, null))
        assertNull(avatar.blocks().customisation())
        assertNull(avatar.blocks().field<String?>("getNameChange", "getName"))
        assertEquals(-1, avatar.blocks().field<Int>("getCombatLevelChange", "getLevel"))
    }

    private fun add(): NpcAvatar {
        val npc = NpcSync.Npc(NPC_INDEX, DAGANNOTH_REX, 2913, 4445, 0)
        mirror.applyNpcs(NpcSync.Frame(listOf(NpcSync.Change.Added(NPC_INDEX, npc, 0, false)), emptyMap()), 0)
        @Suppress("UNCHECKED_CAST")
        val npcs = EntityMirror::class.java.getDeclaredField("npcs").apply { isAccessible = true }.get(mirror) as Map<Int, NpcAvatar>
        return npcs.getValue(NPC_INDEX)
    }

    private fun send(custom: ActorBlock.TypeCustomisation) =
        mirror.applyNpcs(NpcSync.Frame(emptyList(), mapOf(NPC_INDEX to ActorBlock().apply { typeCustomisation = custom })), 0)

    /** rsprot keeps the blocks in a private holder; read them the way its encoder does. */
    private fun NpcAvatar.blocks(): Any =
        NpcAvatarExtendedInfo::class.java.getDeclaredField("blocks").apply { isAccessible = true }.get(extendedInfo)

    private fun Any.customisation(): TypeCustomisation? {
        val body = javaClass.getMethod("getBodyCustomisation").invoke(this)
        return body.javaClass.getMethod("getCustomisation").invoke(body) as TypeCustomisation?
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> Any.field(block: String, getter: String): T {
        val holder = javaClass.getMethod(block).invoke(this)
        return holder.javaClass.getMethod(getter).invoke(holder) as T
    }

    private companion object {
        const val OBSERVER = 1
        const val NPC_INDEX = 10
        const val DAGANNOTH_REX = 2267
    }
}

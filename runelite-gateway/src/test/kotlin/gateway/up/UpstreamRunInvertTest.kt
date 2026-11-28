package gateway.up

import gateway.cache.VarTypes
import gateway.headless.TestCache
import gateway.session.VarpMirror
import net.rsprot.protocol.game.incoming.locs.*
import net.rsprot.protocol.game.incoming.npcs.OpNpcV2
import net.rsprot.protocol.game.incoming.npcs.OpNpcT
import net.rsprot.protocol.game.incoming.objs.OpObjV2
import net.rsprot.protocol.game.incoming.objs.OpObjT
import net.rsprot.protocol.game.incoming.players.OpPlayer
import net.rsprot.protocol.game.incoming.players.OpPlayerT
import net.rsprot.protocol.game.incoming.worldentities.OpWorldEntity
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.util.CombinedId
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Real rsprot messages through Upstream: only the correctly transformed Ctrl byte may change. */
class UpstreamRunInvertTest {
    private val sent = ArrayList<ByteArray>()
    private val upstream = Upstream(VarpMirror(VarTypes(TestCache.cache)), 0) { sent += it }

    private fun check(offset: Int, transform: (Int) -> Int, message: (Boolean) -> IncomingGameMessage) {
        upstream.handle(message(false))
        val plain = sent.removeLast()
        upstream.handle(message(true))
        val ctrl = sent.removeLast()
        assertEquals(transform(0) and 255, plain[offset].toInt() and 255)
        assertEquals(transform(1) and 255, ctrl[offset].toInt() and 255)
        val expected = plain.copyOf()
        expected[offset] = transform(1).toByte()
        assertArrayEquals(expected, ctrl, message(true).toString())
    }

    private val byte = { n: Int -> n }
    private val add = { n: Int -> n + 128 }
    private val sub = { n: Int -> 128 - n }
    private val neg = { n: Int -> -n }

    @Test fun `all ordinary interactions preserve Ctrl through their byte transforms`() {
        val npc = listOf(1 to byte, 3 to byte, 3 to neg, 1 to neg, 1 to add)
        val loc = listOf(5 to neg, 5 to sub, 7 to sub, 7 to neg, 3 to add)
        val obj = listOf(1 to sub, 7 to byte, 7 to sub, 5 to neg, 7 to sub)
        val player = listOf(1 to sub, 1 to byte, 1 to sub, 3 to neg, 3 to sub, 3 to neg, 3 to sub, 1 to byte)
        val entity = listOf(3 to sub, 3 to add, 3 to neg, 1 to sub, 1 to add)
        npc.forEachIndexed { i, (offset, transform) -> check(offset, transform) { OpNpcV2(73, it, i + 1, 0) } }
        loc.forEachIndexed { i, (offset, transform) ->
            check(offset, transform) { OpLocV2(12345, 3090, 3500, it, i + 1, 0) }
            check(offset, transform) { OpLocV3(12345, 3090, 3500, it, i + 1, 0) }
        }
        obj.forEachIndexed { i, (offset, transform) -> check(offset, transform) { OpObjV2(995, 3090, 3500, it, i + 1, 0) } }
        // Player ops are remapped by PlayerOps; target the client slot for each server op.
        val clientOps = listOf(1, 4, 3, 2, 5, 6, 7, 8)
        player.forEachIndexed { i, (offset, transform) -> check(offset, transform) { OpPlayer(73, it, clientOps[i]) } }
        entity.forEachIndexed { i, (offset, transform) -> check(offset, transform) { OpWorldEntity(73, it, i + 1) } }
    }

    @Test fun `a loc sub-menu row goes as LOC_INTERACT with its option and 1-based row`() {
        upstream.handle(OpLocV3(29495, 3129, 3496, false, 4, 3))
        assertArrayEquals(
            byteArrayOf(231.toByte(), 10, 0x73, 0x37, 0x0c, 0x39, 0x0d, 0xa8.toByte(), 0, 0, 4, 3),
            sent.removeLast(),
        )
    }

    @Test fun `inventory use and spell targeting preserve Ctrl on every world target`() {
        for (component in listOf(CombinedId((149 shl 16) or 0), CombinedId((218 shl 16) or 1))) {
            val inventory = component.combinedId == (149 shl 16)
            check(if (inventory) 9 else 15, if (inventory) sub else neg) { OpLocTV1(12345, 3090, 3500, it, component, 2, 995) }
            check(if (inventory) 9 else 15, if (inventory) sub else neg) { OpLocTV2(12345, 3090, 3500, it, component, 2, 995) }
            check(13, if (inventory) sub else byte) { OpObjT(995, 3090, 3500, it, component, 2, 995) }
            check(if (inventory) 3 else 11, if (inventory) byte else add) { OpNpcT(73, it, component, 2, 995) }
            check(if (inventory) 11 else 1, if (inventory) add else neg) { OpPlayerT(73, it, component, 2, 995) }
        }
    }
}

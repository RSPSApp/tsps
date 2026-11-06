package gateway.up

import gateway.cache.VarTypes
import gateway.headless.TestCache
import gateway.session.VarpMirror
import net.rsprot.protocol.game.incoming.buttons.IfButtonD
import net.rsprot.protocol.util.CombinedId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Which item tsps is told was dragged, for the drags RuneLite was recorded sending. */
class UpstreamDragTest {
    private val sent = ArrayList<ByteArray>()
    private val upstream = Upstream(VarpMirror(VarTypes(TestCache.cache)), 0) { sent += it }

    /** tsps's IF_BUTTOND: u16le target obj, i32le target, u16 source obj, ... */
    private fun dragged(selected: Int, selectedSub: Int, selectedObj: Int, target: Int, targetSub: Int, targetObj: Int): Int {
        upstream.handle(IfButtonD(CombinedId(selected), selectedSub, selectedObj, CombinedId(target), targetSub, targetObj))
        val packet = sent.removeLast()
        return ((packet[7].toInt() and 0xFF) shl 8) or (packet[8].toInt() and 0xFF)
    }

    @Test
    fun `the dragged item, by where the drag ends`() {
        // Recorded: slot 0 onto slot 1, after the client swapped them on screen.
        assertEquals(806, dragged(ITEMS, 0, 26382, ITEMS, 1, 806))
        // Recorded: slot 1 onto tab 1's button.
        assertEquals(26382, dragged(ITEMS, 1, 26382, TABS, 11, NO_OBJ))
        // Into the empty space after a tab's items: nothing to swap.
        assertEquals(26382, dragged(ITEMS, 1, 26382, ITEMS, 1428, NO_OBJ))
        // Onto an empty slot: swapped on screen, so the item is now at the target.
        assertEquals(26382, dragged(ITEMS, 1, NO_OBJ, ITEMS, 5, 26382))
    }

    private companion object {
        const val ITEMS = (12 shl 16) or 12
        const val TABS = (12 shl 16) or 10
        const val NO_OBJ = 0xFFFF
    }
}

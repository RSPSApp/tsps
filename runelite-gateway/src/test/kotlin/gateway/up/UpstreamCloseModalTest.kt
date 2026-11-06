package gateway.up

import gateway.cache.VarTypes
import gateway.headless.TestCache
import gateway.session.VarpMirror
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.incoming.misc.user.CloseModal
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Test
import net.rsprot.protocol.game.incoming.resumed.ResumePObjDialog

/** CLOSE_MODAL: the client has closed its modals itself (Escape, a close button) and says so. */
class UpstreamCloseModalTest {
    private val sent = ArrayList<ByteArray>()
    private var welcomeShown = false
    private val upstream = Upstream(VarpMirror(VarTypes(TestCache.cache)), 0, welcomeShown = { welcomeShown }) { sent += it }

    @Test
    fun `closing a modal is IF_CLOSE`() {
        upstream.handle(CloseModal)
        assertArrayEquals(TspsWriter().fixed(IF_CLOSE), sent.single())
    }

    @Test
    fun `closing the welcome screen is Play`() {
        // Live opens it as a modal too, so Escape closes it; tsps only leaves it on Play.
        welcomeShown = true
        upstream.handle(CloseModal)
        // `widget_action` as ClientProtocol.ts reads IF_BUTTONX: 378:72, no slot or obj, op 1.
        assertArrayEquals(TspsWriter().i32((378 shl 16) or 72).u16(0xFFFF).u16(0xFFFF).u8(1).fixed(IF_BUTTONX), sent.single())
    }

    @Test
    fun `object search answers use the existing item-selection input route`() {
        upstream.handle(ResumePObjDialog(556))
        assertArrayEquals(TspsWriter().string("556").varByte(RESUME_NAMEDIALOG), sent.single())
    }

    private companion object {
        const val RESUME_NAMEDIALOG = 193
        const val IF_CLOSE = 55
        const val IF_BUTTONX = 91
    }
}

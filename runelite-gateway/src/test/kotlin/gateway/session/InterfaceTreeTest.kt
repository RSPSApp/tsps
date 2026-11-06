package gateway.session

import gateway.cache.Cache
import gateway.cache.EnumTypes
import gateway.cache.VarTypes
import gateway.config.GatewayConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class InterfaceTreeTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)

    @Test
    fun `mounts on the resizable root move to the active root's component`() {
        val tree = InterfaceTree(EnumTypes(cache))
        val mainModal = (161 shl 16) or 16
        assertEquals(mainModal, tree.remap(mainModal))
        tree.setRoot(FIXED_ROOT)
        assertEquals((FIXED_ROOT shl 16) or 41, tree.remap(mainModal))
        // The login root (165) has the main modal elsewhere; the welcome screen goes on its own slot.
        tree.setRoot(InterfaceTree.LOGIN_ROOT)
        assertEquals((InterfaceTree.LOGIN_ROOT shl 16) or 14, tree.remap(mainModal))
        tree.gameframe(CHATBOX, mounted = true)
        tree.setRoot(FIXED_ROOT)
        assertEquals(listOf(tree.remap(CHATBOX, InterfaceTree.LOGIN_ROOT) to tree.remap(CHATBOX)), tree.moves(InterfaceTree.LOGIN_ROOT))
        // Components on other interfaces stay where they are.
        assertEquals((149 shl 16) or 0, tree.remap((149 shl 16) or 0))
    }

    @Test
    fun `varbits are written into their varp`() {
        val varps = VarpMirror(VarTypes(cache))
        // Varbit 25 is bit 22 of varp 1575.
        varps.setVarp(1575, 0b11)
        varps.setVarbit(25, 1)
        assertEquals(0b11 or (1 shl 22), varps[1575])
        assertEquals(1, varps.getVarbit(25))
        // Varps past the client's count (tsps's own GE state) aren't sent.
        assertEquals(null, varps.setVarp(7900, 1))
    }

    private companion object {
        const val FIXED_ROOT = 548
        /** Where tsps mounts the chatbox (162). */
        const val CHATBOX = (161 shl 16) or 96
    }
}

package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.outgoing.social.UpdateFriendList
import net.rsprot.protocol.game.outgoing.social.UpdateIgnoreList
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** tsps's friends/ignores snapshot (`encodeFriendsChatSnapshot`) as the official client's list updates. */
class SocialTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val social = Social { sent += it }

    /** A snapshot with no chat-channel; each entry is (name, previous name, online). */
    private fun snapshot(friends: List<Triple<String, String, Boolean>>, ignores: List<Pair<String, String>> = emptyList()) {
        val writer = TspsWriter().u8(0).u16(friends.size)
        for ((name, previous, online) in friends) writer.string(name).string(previous).u16(if (online) 1 else 0).u8(0).u8(if (online) 1 else 0)
        writer.u16(ignores.size)
        for ((name, previous) in ignores) writer.string(name).string(previous)
        social.handle(TspsPacket(TspsServerPacket.FRIENDS_CHAT_UPDATE, writer.body()))
    }

    private fun lastFriends() = sent.filterIsInstance<UpdateFriendList>().last().friends

    private fun lastIgnores() = sent.filterIsInstance<UpdateIgnoreList>().last().ignores.filterIsInstance<UpdateIgnoreList.AddedIgnoredEntry>()

    /**
     * The client's list, read the way it reads an update (FriendContainer.read): find the entry by
     * its current name; with the rename flag, an entry under the previous name is that same friend,
     * so it is renamed (or dropped when the new name is already listed); otherwise a new entry.
     */
    private fun apply(list: MutableList<String>, entries: List<Triple<Boolean, String, String?>>) {
        for ((renamed, name, previous) in entries) {
            var entry = list.firstOrNull { it.equals(name, ignoreCase = true) }
            if (renamed && previous != null) {
                val old = list.firstOrNull { it.equals(previous, ignoreCase = true) }
                if (old != null && old != entry) {
                    if (entry != null) list.remove(old) else entry = old
                }
            }
            if (entry != null) list[list.indexOf(entry)] = name else list += name
        }
    }

    @Test
    fun `a friend's rename renames their entry instead of adding a second`() {
        snapshot(listOf(Triple("Bob", "", true), Triple("Carol", "", false)))
        assertEquals(listOf(false, false), lastFriends().map { it.added })
        val list = mutableListOf<String>()
        apply(list, lastFriends().map { Triple(it.added, it.name, it.previousName) })
        assertEquals(listOf("Bob", "Carol"), list)

        snapshot(listOf(Triple("Zed", "Bob", true), Triple("Carol", "", false)))
        val renamed = lastFriends()
        assertEquals(listOf(true, false), renamed.map { it.added })
        assertEquals(listOf("Bob", null), renamed.map { it.previousName })
        apply(list, renamed.map { Triple(it.added, it.name, it.previousName) })
        assertEquals(listOf("Zed", "Carol"), list)

        // Offline friends carry the flag too, and later snapshots leave the list as it is.
        snapshot(listOf(Triple("Zed", "Bob", false), Triple("Carol", "", false)))
        assertEquals(listOf(true, false), lastFriends().map { it.added })
        apply(list, lastFriends().map { Triple(it.added, it.name, it.previousName) })
        assertEquals(listOf("Zed", "Carol"), list)
    }

    @Test
    fun `an ignored player's rename carries the flag too`() {
        snapshot(emptyList(), listOf("Bob" to "", "Dave" to ""))
        assertEquals(listOf(false, false), lastIgnores().map { it.added })
        snapshot(emptyList(), listOf("Zed" to "Bob", "Dave" to ""))
        assertEquals(listOf(true, false), lastIgnores().map { it.added })
        assertEquals(listOf("Bob", null), lastIgnores().map { it.previousName })
    }

    @Test
    fun `renames one after another keep one entry, as long as each one is sent`() {
        val friends = mutableListOf<String>()
        val ignores = mutableListOf<String>()
        for (step in listOf(Triple("Bob", "", "Ann"), Triple("Zed", "Bob", "Ann"), Triple("Yew", "Zed", "Ann"))) {
            snapshot(listOf(Triple(step.first, step.second, true), Triple(step.third, "", true)), listOf(step.first to step.second))
            apply(friends, lastFriends().map { Triple(it.added, it.name, it.previousName) })
            apply(ignores, lastIgnores().map { Triple(it.added, it.name, it.previousName) })
        }
        assertEquals(listOf("Yew", "Ann"), friends)
        assertEquals(listOf("Yew"), ignores)
    }
}

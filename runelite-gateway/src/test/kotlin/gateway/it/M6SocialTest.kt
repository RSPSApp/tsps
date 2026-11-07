package gateway.it

import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.social.MessagePrivate
import net.rsprox.protocol.game.outgoing.model.social.MessagePrivateEcho
import net.rsprox.protocol.game.outgoing.model.social.UpdateFriendList
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** M6: friends and private messages between two official clients. */
class M6SocialTest {
    @Test
    fun `a friend shows online and private messages arrive both ways`() {
        val senderName = LiveGateway.newAccount("gwpms")
        val recipientName = LiveGateway.newAccount("gwpmr")
        LiveGateway.login(recipientName).use { recipient ->
            recipient.expect<RebuildLoginV2>()
            LiveGateway.login(senderName).use { sender ->
                sender.expect<RebuildLoginV2>()
                sender.addFriend(recipientName)
                // Login sends the (empty) list too; wait for the one with the new friend.
                var friend: UpdateFriendList.Friend? = null
                while (friend == null) {
                    friend = sender.expect<UpdateFriendList>().friends.firstOrNull { it.name.equals(recipientName, ignoreCase = true) }
                }
                assertTrue(friend is UpdateFriendList.OnlineFriend, "friend shows $friend")

                sender.privateMessage(recipientName, TEXT)
                val echo = sender.expect<MessagePrivateEcho>()
                assertEquals(TEXT, echo.message.lowercase())
                val received = recipient.expect<MessagePrivate>()
                assertTrue(received.sender.equals(senderName, ignoreCase = true), "from ${received.sender}")
                assertEquals(TEXT, received.message.lowercase())
            }
        }
    }

    private companion object {
        const val TEXT = "hello through the gateway"
    }
}

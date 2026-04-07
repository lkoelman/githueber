# Use bidirectional ACP session

The interface in [ACPClientLike](../src/acp/ACPSessionManager.ts) looks wrong when comparing to https://agentclientprotocol.com/protocol/prompt-turn and the official ACP client interface described on https://agentclientprotocol.com/protocol/schema#client. If we want to follow the Agent Client Protocol (ACP) correctly, we need bidirectional prompt turns. Refer to the ACP documentation ("prompt turn" page) to see how `session/update` messages are sent back to ACP Client. Then refer to the [official ACP Client example](https://github.com/agentclientprotocol/typescript-sdk/sdk/blob/main/src/examples/client.ts) to see how a client is implemented.

The reason for the interface divergence could be related to the fact that we were stuck on an outdated version of the `@agentclientprotocol/sdk` dependency. This has now been updated. Fix our ACP client implementation and add bidirectional message flow, where agent updates are handled by `onSessionEvent` in opencode-gh-buddy/src/acp/ACPSessionManager.ts .

The OpenCode ACP server is running on port 9000. Test your changes against this running server using the new implementation. Ideally, everything should work using our single ACP client and we don't need a separate OpenCode client in ACPSessionManager.ts . If our generic ACP client works, delete the `OpenCodeHTTPClient` class.

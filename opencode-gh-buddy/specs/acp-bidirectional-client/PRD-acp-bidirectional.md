# Use bidirectional ACP session

The interface in [ACPClientLike](../src/acp/ACPSessionManager.ts) looks wrong when comparing to https://agentclientprotocol.com/protocol/prompt-turn and the official ACP client interface described on https://agentclientprotocol.com/protocol/schema . If we want to follow the Agent Client Protocol (ACP) correctly, we need bidirectional prompt turns and implement follow the client scheme correctly. Read the documentation pages linked above to see how `session/update` messages are sent back to ACP Client and to get a better idea of the protocol and schema. Then read the official example client code in [client.ts](./examples/client.ts) and the more complex example code under [vscode-acp-core](./examples/vscode-acp-core/) to see how the ACP protocol can be implemented.


After implementing the revised ACP client, test it against the running OpenCode ACP server. The OpenCode ACP server is running on port 9000. Ideally, everything should work using our new ACP client and we don't need a separate OpenCode client in ACPSessionManager.ts . If our generic ACP client works, delete the `OpenCodeHTTPClient` class.

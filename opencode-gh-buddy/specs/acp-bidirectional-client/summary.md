## Feature Summary

• Implemented the ACP/client rewrite in opencode-gh-buddy/src/acp/ACPSessionManager.ts. The old OpenCodeHTTPClient path is gone; createACPClient() now builds a single bidirectional client
  that:

  - uses /session and /session/{id}/prompt_async for prompt turns
  - keeps a live /global/event SSE subscription
  - waits for the stream handshake before sending work
  - maps turn completion once per prompt via session.status busy/idle, treating output containing [AWAITING_APPROVAL] as pause and other completed turns as completion

  I added regression coverage in opencode-gh-buddy/tests/acp-session-manager.test.ts and updated the high-level docs in opencode-gh-buddy/docs/ARCHITECTURE.md and opencode-gh-buddy/
  README.md.

  Verification:

  - bun test passes for the package
  - live probe against http://127.0.0.1:9000 succeeded: one prompt returning [AWAITING_APPROVAL] produced a pause event, and a follow-up prompt produced one completion event

  There were already unrelated local changes in opencode-gh-buddy/specs/acp-bidirectional-client/PRD-acp-bidirectional.md and untracked example files under specs/acp-bidirectional-client/
  examples/; I left those as-is.

## Question: ACP Interface

› Explain why the new ACP client implementation in opencode-gh-buddy/src/acp/ACPSessionManager.ts looks so different from the one described in
  https://agentclientprotocol.com/protocol/schema and the one implemented in the official example code at opencode-gh-buddy/specs/acp-bidirectional-client/examples/client.ts . Why do we
  not implement `acp.Client` from the SDK dependency '@agentclientprotocol/sdk'?


• I’m comparing the current ACPSessionManager.ts against the local example client and the ACP schema so I can explain the mismatch concretely, not hand-wave it.

• Explored
  └ Read client.ts, ACPSessionManager.ts
    Search interface Client|type Client|class Client|createClient|Bidirectional in sdk

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• I’ve confirmed the local example is a full protocol peer over JSON-RPC-style streams, while our file is an adapter around OpenCode’s existing HTTP/SSE API. I’m checking the SDK surface
  next so I can explain why we intentionally did not implement its Client interface.

• Explored
  └ Read ACPSessionManager.ts
    Search *.d.ts in sdk
    Read package.json

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• I have the local shape now. I’m pulling the published ACP schema and SDK types to distinguish “protocol peer” responsibilities from the narrower adapter this repo actually needs.

◦ Searching the web

• Searched https://agentclientprotocol.com/protocol/schema

• Searching the web

• Searched 'export interface Client' in https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts

• Explored
  └ Search export interface Client|interface Client|class ClientSideConnection|implements Client in acp.d.ts
    Read acp.d.ts, ARCHITECTURE.md
    Search createACPClient|ACPClientLike|ACPSessionManager\( in opencode-gh-buddy
    Read README.md, PRD-acp-bidirectional.md

• Searching the web

• Searched https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


• I have enough context. The short version is that acp.Client is the wrong abstraction for this file: the SDK’s Client is the editor-side callback surface in a full ACP RPC connection,
  while ACPSessionManager.ts is a daemon-specific adapter over OpenCode’s HTTP and SSE endpoints. I’m pulling exact line numbers so the explanation can point at the concrete seams in this
  repo.

• Explored
  └ Read ACPSessionManager.ts, client.ts

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• The implementations are solving different problems at different layers.

  In the ACP schema and in the official example, acp.Client means “the editor-side callback handler in a full ACP connection.” The example in opencode-gh-buddy/specs/acp-bidirectional-cli
  ent/examples/client.ts:11 implements requestPermission, sessionUpdate, and filesystem methods because the agent is expected to call back into the client over a bidirectional ACP stream.
  That example then wraps the handler in new acp.ClientSideConnection(...) on top of an ndJsonStream transport at opencode-gh-buddy/specs/acp-bidirectional-client/examples/client.ts:117.
  That is the SDK’s native model, and it matches the published schema: https://agentclientprotocol.com/protocol/schema (https://agentclientprotocol.com/protocol/schema) and the SDK surface
  in @agentclientprotocol/sdk.

  Our opencode-gh-buddy/src/acp/ACPSessionManager.ts is not that. It defines its own narrow ACPClientLike at opencode-gh-buddy/src/acp/ACPSessionManager.ts:18 because the daemon only needs
  four things: connect, create a session, send a prompt, stop a session, and observe pause/completion. The concrete class then talks to OpenCode’s HTTP endpoints and global SSE stream:

  - /global/health and /global/event at opencode-gh-buddy/src/acp/ACPSessionManager.ts:109
  - /session and /session/{id}/prompt_async at opencode-gh-buddy/src/acp/ACPSessionManager.ts:304
  - /session/{id}/abort at opencode-gh-buddy/src/acp/ACPSessionManager.ts:340

  So the main reason it looks different is that it is an OpenCode-specific transport adapter, not a generic ACP protocol peer.

  Why we do not implement acp.Client from @agentclientprotocol/sdk:

  1. acp.Client is the wrong side of the protocol for this class.
     It is the interface the agent calls into. Our file is the opposite direction: the daemon drives OpenCode and translates its events into daemon lifecycle updates.
  2. acp.Client is not the connection object.
     Even if we implemented acp.Client, we would still need an acp.ClientSideConnection plus a compatible bidirectional Stream. Our code currently has neither; it uses fetch and SSE
     instead.
  3. OpenCode exposes HTTP + SSE here, not the SDK’s stream transport.
     The SDK example uses ndJsonStream over process stdio. Our implementation consumes OpenCode’s server-specific endpoints and event payloads like session.status, message.part.delta, and
     message.part.updated at opencode-gh-buddy/src/acp/ACPSessionManager.ts:195. That is protocol-shaped, but not the same transport abstraction as the SDK example.
  4. The daemon intentionally collapses ACP into a smaller internal contract.
     ACPSessionManager only needs session lifecycle signals for GitHub routing, so it maps OpenCode events into sessionPaused / sessionCompleted at opencode-gh-buddy/src/acp/
     ACPSessionManager.ts:266 and then updates daemon state at opencode-gh-buddy/src/acp/ACPSessionManager.ts:389. It does not need full ACP features like permission RPCs, terminal
     handles, or file APIs.

  The tradeoff is that this implementation is less ACP-native than the schema/example. It is really “ACP semantics adapted onto OpenCode’s HTTP API,” not “a generic ACP SDK client.” That
  is also why it has heuristics the schema example does not, like detecting pause via [AWAITING_APPROVAL] at opencode-gh-buddy/src/acp/ACPSessionManager.ts:282.

  If you want strict SDK-style ACP here, the shape would need to change substantially:

  - replace the local ACPClientLike with an SDK-backed adapter
  - provide a real ACP Stream transport for OpenCode
  - implement the editor-side callbacks required by acp.Client
  - drive sessions through ClientSideConnection.initialize/newSession/prompt/cancel

  Without that transport layer, implementing acp.Client directly would mostly be type theater: it would satisfy the wrong interface while still not giving this daemon a real ACP
  connection.
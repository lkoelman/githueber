Currently, coding sessions started by Githueber using Codex are not exposed as normal user-facing sessions: we cannot resume or attach to them. This likely results from the way that we use the Codex app server SDK (https://developers.openai.com/codex/app-server), with its generated bindings in githueber/src/codex/generated.

Some additional information is given in issue #17: https://github.com/lkoelman/githueber/issues/17 .

Must do: find a way of starting the Codex sessions so that they show up as normal Codex sessions when using the `codex` CLI.
Could do: find a way to attach to a Codex session started by Githueber, when it is still open.

You might want to read the codex documentation online, check out the codex source code at https://github.com/openai/codex , play with the CLI, and/or write some custom test scripts to understand codex' functionality.


Notes
- `codex resume --all` lists all sessions (however this seems to but the shell in an interactive mode, similar to `less`: it doesn't just print all sessions to stdout and exits)
    - `codex resume --all --include-non-interactive` promises to also include non-interactive sessions. It's not clear whether that includes sessions started using the app server protocol.
- session visibility might depend on them being still open. You might want to try creating a Codex session, then checking its visibility

Acceptance Criteria:
- When githueber starts a coding session in the background, and it is shut down (e.g. due to Githueber shutdown), the session should show up when running `codex resume [--include-non-interactive]`
- When githueber starts a coding session in the background, and it is still open, `gbr sessions` should list the session with a label that it is still open (and in case codex can't show open sessions, note that it is not yet resumable or attachable)
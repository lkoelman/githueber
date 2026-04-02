## 1. Configuration Model

- [ ] 1.1 Add repository-aware TypeScript types that represent a normalized `repositories` map and repository-scoped session identity.
- [ ] 1.2 Update `ConfigManager` to accept both legacy single-repository config and the new multi-repository format.
- [ ] 1.3 Add tests covering multi-repository config loading, legacy compatibility mode, and invalid ambiguous configs.

## 2. Repository-Scoped Dispatch

- [ ] 2.1 Refactor GitHub issue and session models so work items are keyed by repository key plus issue number.
- [ ] 2.2 Update poller creation and daemon coordination so each configured repository is polled independently.
- [ ] 2.3 Update router and label transition logic so all issue actions execute against the repository that produced the issue.
- [ ] 2.4 Add tests covering same-number issues in different repositories and correct repository-targeted label updates.

## 3. ACP and Prompt Context

- [ ] 3.1 Extend initialization prompt generation to include repository key, owner/repo, and repository-specific checkout path.
- [ ] 3.2 Update ACP session storage and pause/completion callbacks to resolve repository-scoped sessions correctly.
- [ ] 3.3 Add tests covering repository-aware prompt content and approval/resume routing.

## 4. CLI and Operator Visibility

- [ ] 4.1 Update IPC and CLI session output to include repository identity for every active session.
- [ ] 4.2 Keep manual stop operations working with existing session IDs while exposing repository context in command output.
- [ ] 4.3 Add CLI tests covering repository-aware session listings.

## 5. Documentation and Example Config

- [ ] 5.1 Update the example daemon config to show the new multi-repository format.
- [ ] 5.2 Update the package README with multi-repository setup and CLI usage notes.

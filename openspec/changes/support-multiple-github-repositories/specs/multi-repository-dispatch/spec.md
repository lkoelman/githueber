## ADDED Requirements

### Requirement: Daemon configuration supports multiple repositories
The daemon SHALL accept a configuration format that defines more than one target repository, and it MUST normalize the new multi-repository format into a repository-scoped internal model.

#### Scenario: Load a multi-repository config
- **WHEN** the daemon starts with a config that defines multiple repository entries
- **THEN** it loads each repository entry with its GitHub coordinates and local checkout path
- **THEN** it makes each repository available to polling and routing logic by a stable repository key

### Requirement: Polling and routing remain repository-scoped
The daemon SHALL poll each configured repository independently and MUST evaluate issues, comments, and label transitions against the repository that produced them.

#### Scenario: Same issue number exists in different repositories
- **WHEN** repository `frontend` and repository `backend` both contain issue `#42`
- **THEN** the daemon treats them as separate work items
- **THEN** starting, resuming, pausing, or completing one issue does not affect the other repository's issue

#### Scenario: Label updates target the correct repository
- **WHEN** the daemon transitions an issue from queued to processing
- **THEN** it updates labels in the same repository where that issue was polled
- **THEN** it does not perform label changes against any other configured repository

### Requirement: Session records include repository identity
The daemon SHALL persist active session metadata with repository identity in addition to issue number and agent name.

#### Scenario: Active sessions are listed through the CLI
- **WHEN** an operator runs the sessions command while multiple repositories have active sessions
- **THEN** each session entry includes a repository key or owner/repo identifier
- **THEN** operators can distinguish sessions that share the same issue number

#### Scenario: Session callbacks update the correct issue
- **WHEN** an ACP session pauses or completes
- **THEN** the daemon resolves the session back to its repository-scoped issue identity
- **THEN** it updates the corresponding issue labels in that same repository

### Requirement: Agent prompts identify the target repository
The daemon SHALL include repository identity in the initialization prompt sent to OpenCode agents.

#### Scenario: Worker prompt includes repository context
- **WHEN** the daemon starts a new session for a repository-scoped issue
- **THEN** the prompt includes the repository key, owner/repo name, and local checkout path
- **THEN** the prompt instructs the agent to operate in the repository-specific checkout

#### Scenario: Revision and approval messages preserve repository association
- **WHEN** the daemon resumes a paused session after `/approve` or `/revise`
- **THEN** it sends the message to the existing session associated with that repository-scoped issue
- **THEN** it does not route the message to a session from another repository

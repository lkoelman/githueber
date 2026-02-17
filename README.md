# agents-config
Configuration for coding agents

## Contents

- **OpenCode Skills**: Custom skills for OpenCode agents
- **GitHub Orchestrator**: Automated issue processing system

---

# GitHub Orchestrator

Automated GitHub issue processing using OpenCode agents. This system monitors GitHub issues with specific labels and automatically processes them using OpenCode, with support for both direct agent execution and plan/build workflows with approval mechanisms.

## Features

- **Automated Issue Processing**: Monitors GitHub issues and processes them automatically
- **Multiple Workflow Modes**:
  - Direct agent execution for specific issue types
  - Plan/build workflow with optional approval
  - Plan revision based on feedback
- **Label-Based State Management**: Uses GitHub labels to track processing state
- **Concurrent Processing**: Configurable parallelism for handling multiple issues
- **File-Based Locking**: Prevents race conditions when multiple instances run
- **Whiteboard Tracking**: Markdown-based state tracking for active jobs
- **Comprehensive Logging**: Detailed logging to file and console
- **CRON Integration**: Easy setup for scheduled execution

## Requirements

- **Python**: 3.9 or higher
- **gh CLI**: GitHub CLI for API access ([install](https://cli.github.com/))
- **opencode**: OpenCode CLI ([install](https://opencode.ai/))
- **PyYAML**: Python YAML parser (installed automatically)

## Quick Start

```bash
# 1. Install package
pip install -e .

# 2. Configure
cp config/gh-orchestrator-config.example.yaml config/gh-orchestrator-config.yaml
nano config/gh-orchestrator-config.yaml

# 3. Authenticate GitHub
gh auth login

# 4. Setup CRON
./src/gh-orchestrator/setup_cron.py

# 5. Test manually
gh-orchestrator --config config/gh-orchestrator-config.yaml
```

## Installation

### 1. Install Python Package

```bash
# Install in editable mode
pip install -e .

# Or install with dev dependencies
pip install -e .[dev]
```

This creates the `gh-orchestrator` command in your PATH.

### 2. Configure

```bash
# Copy example configuration
cp config/gh-orchestrator-config.example.yaml config/gh-orchestrator-config.yaml

# Edit configuration
nano config/gh-orchestrator-config.yaml
```

Key configuration fields:
- `github.repo_owner`: Your GitHub organization/user
- `github.repo_name`: Repository name
- `github.target_repo_path`: Local path to repository where OpenCode executes
- `agent_mapping`: Map issue labels to OpenCode agents
- `execution.auto_approve`: Auto-approve plans (true) or wait for approval (false)
- `execution.concurrency`: Number of parallel issue processors

### 3. Authenticate GitHub CLI

```bash
gh auth login
```

### 4. Setup CRON Job

```bash
./src/gh-orchestrator/setup_cron.py --config config/gh-orchestrator-config.yaml
```

## Usage

### Manual Execution

```bash
# Run with default config
gh-orchestrator

# Run with custom config
gh-orchestrator --config path/to/config.yaml

# Run without lock (for testing)
gh-orchestrator --no-lock
```

### Workflow Examples

#### Example 1: Issue with Specific Agent

1. User creates issue with labels: `agent-queue`, `bug-fix`
2. System maps `bug-fix` to agent via config
3. Executes OpenCode with that agent
4. Posts results and marks complete

#### Example 2: Plan/Build with Auto-Approve

1. Issue with `agent-queue` (no agent mapping)
2. Generates plan, posts as comment
3. Auto-executes build (if `auto_approve: true`)
4. Marks complete

#### Example 3: Plan/Build with Manual Approval

1. Generates and posts plan
2. Waits for user `/approve` comment
3. Executes build on next CRON run
4. Marks complete

## Configuration

See `config/gh-orchestrator-config.example.yaml` for all options.

### Label Configuration

- `queue_label`: Issues ready for processing
- `processing_label`: Currently being processed
- `await_plan_label`: Waiting for plan approval
- `completed_label`: Successfully completed
- `failed_label`: Failed with errors

### Agent Mapping

```yaml
agent_mapping:
  "bug-fix": "bug-fixer-agent"
  "feature-request": "feature-builder-agent"
```

## Monitoring

### View Whiteboard

```bash
cat whiteboard/whiteboard.md
```

### View Logs

```bash
tail -f logs/gh-orchestrator.log
tail -f logs/cron.log
```

## Troubleshooting

### Lock timeout
```bash
# Remove stale lock
rm whiteboard/whiteboard.md.lock
```

### OpenCode not found
```bash
# Install from https://opencode.ai/
```

### GitHub auth failed
```bash
gh auth login
```

## Development

### Running Tests

```bash
pip install -e .[dev]
pytest tests/
```

### Project Structure

```
agents-config/
├── src/gh-orchestrator/gh_orchestrator/     # Main package
├── tests/                        # Unit tests
├── config/                       # Configuration
├── whiteboard/                   # State tracking
├── logs/                         # Log files
└── src/gh-orchestrator/setup_cron.py                 # CRON setup
```

## CRON Management

```bash
# View jobs
crontab -l

# Edit jobs
crontab -e

# Remove gh-orchestrator job
crontab -l | grep -v 'gh-orchestrator' | crontab -
```

## Credits

Built with [OpenCode](https://opencode.ai/), [GitHub CLI](https://cli.github.com/), and [PyYAML](https://pyyaml.org/).

---

# OpenCode Skills Setup

```sh
# Install GitHub CLI
# (see https://github.com/cli/cli/blob/trunk/docs/install_linux.md)

# Install extension to see inline comments
gh extension install agynio/gh-pr-review

# Link skills directory
ln -s $(pwd)/opencode/skills ~/.opencode/skills
```
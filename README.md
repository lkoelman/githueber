# agents-config
Configuration for coding agents

## Contents

- **GitHub Orchestrator**: Automated issue processing system
- **OpenCode GitHub Buddy**: Bun/TypeScript daemon that bridges GitHub issue state to OpenCode over ACP
- **OpenCode Configuration**: Custom agents and skills for OpenCode
- **Gemini CLI Configuration**: Custom agents and skills for Gemini CLI

---

# GitHub Orchestrator

Simple prototype of python-based orchestrator [gh-orchestrator/README.md](./gh-orchestrator/README.md)

## OpenCode GitHub Buddy

TypeScript/Bun daemon scaffold: [opencode-gh-buddy/README.md](./opencode-gh-buddy/README.md)

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

# OpenCode Configuration

This repository provides custom agents and skills for OpenCode. Installation is managed using [GNU Stow](https://www.gnu.org/software/stow/), which creates symlinks from `~/.opencode/` to this repository.

## Prerequisites

### 1. Install GNU Stow

For example, on Debian/Ubuntu: `sudo apt-get install stow`.

### 2. Install GitHub CLI

See the [official installation guide](https://github.com/cli/cli/blob/trunk/docs/install_linux.md).

### 3. Install GitHub CLI Extension (for PR reviews)

```bash
gh extension install agynio/gh-pr-review
```

## Installation

### Option 1: Using the Installation Script (Recommended)

```bash
./scripts/install-opencode-config.sh
```

This script will:
- Check if GNU Stow is installed
- Detect and remove any existing manual symlinks (with confirmation)
- Install the configuration using Stow
- Verify the installation

### Option 2: Manual Installation with Stow

```bash
# From the repository root
stow -v -R -t ~ opencode
```

Flags explained:
- `-v`: Verbose output
- `-R`: Restow (reinstall) - safe to use for updates
- `-t ~`: Set target directory to home directory

## Verifying Installation

Check that the symlinks were created correctly:

```bash
ls -la ~/.opencode/
```

You should see:
- `agents/` → symlink to this repository
- `skills/` → symlink to this repository

List installed agents and skills:

```bash
ls ~/.opencode/agents/
ls ~/.opencode/skills/
```

## Updating

To update after pulling new changes:

```bash
git pull
./install-opencode-config.sh
# or
stow -v -R -t ~ opencode
```

The `-R` (restow) flag safely updates symlinks.

## Uninstallation

### Option 1: Using the Uninstallation Script

```bash
./scripts/uninstall-opencode-config.sh
```

This script will:
- Remove all stow-managed symlinks
- Optionally remove the entire `~/.opencode/` directory if empty

### Option 2: Manual Uninstallation with Stow

```bash
stow -v -D -t ~ opencode
```

The `-D` flag removes symlinks.

## Troubleshooting

### Conflict with existing files

If you have existing files in `~/.opencode/`, Stow will report conflicts and refuse to install. You have two options:

1. **Backup and remove existing files:**
   ```bash
   mv ~/.opencode ~/.opencode.backup
   ./install-opencode-config.sh
   ```

2. **Manually resolve conflicts** by removing or moving specific conflicting files.

### Existing manual symlinks

If you previously installed using manual symlinks (e.g., `ln -s`), the installation script will detect them and offer to remove them. Alternatively, remove them manually:

```bash
rm ~/.opencode/agents ~/.opencode/skills
./install-opencode-config.sh
```

### Stow reports "target is not owned by stow"

This means there are existing files/directories that weren't created by Stow. Remove them as described above.

### Check Stow dry-run

To see what Stow would do without making changes:

```bash
stow -n -v -R -t ~ opencode
```

The `-n` flag performs a dry-run.

## What Gets Installed

After installation, `~/.opencode/` will contain:

- **agents/**: Custom OpenCode agent configurations
  - `autoplan.md` - Plans code changes before execution
  - `search-grounding.md` - Web search with grounded results
  - `search-grounding-subagent.md` - Search agent for subagent use

- **skills/**: Custom OpenCode skills
  - `github-cli/` - GitHub CLI integration skill

All files are symlinked to this repository, so updates are automatically reflected after pulling changes and restowing.

---

# Gemini CLI Configuration

This repository provides custom agents and skills for Gemini CLI. Installation is managed using [GNU Stow](https://www.gnu.org/software/stow/), which creates symlinks from `~/.gemini/` to this repository.

## Installation

### 1. Install GNU Stow

If not already installed (see OpenCode Configuration above).

### 2. Install Configuration with Stow

```bash
# From the repository root
stow -v -R -t ~ gemini-cli
```

### 3. Verify Installation

Check that the symlinks were created correctly:

```bash
ls -la ~/.gemini/agents/
ls -la ~/.gemini/skills/
```

### 4. Reload Skills

After installation, reload the skills in your interactive Gemini CLI session to enable them:

```bash
/skills reload
```

## What Gets Installed

- **agents/**: Custom Gemini CLI agent configurations
  - `autoplan.md` - Plans code changes before execution
  - `plan-writer.md` - Writes plans for changes

- **skills/**: Custom Gemini CLI skills
  - `github-cli/` - GitHub CLI integration skill

All files are symlinked to this repository.

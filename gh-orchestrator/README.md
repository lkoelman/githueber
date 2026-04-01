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
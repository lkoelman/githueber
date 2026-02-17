"""Tests for configuration loader."""

import pytest
from pathlib import Path
from gh_orchestrator.config import ConfigLoader, ConfigError
from gh_orchestrator.models import Config


def test_load_config_missing_file():
    """Test loading non-existent config file."""
    with pytest.raises(ConfigError, match="Config file not found"):
        ConfigLoader.load(Path("/nonexistent/config.yaml"))


def test_load_config_invalid_yaml(tmp_path):
    """Test loading invalid YAML."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text("invalid: yaml: syntax: error:")
    
    with pytest.raises(ConfigError, match="Invalid YAML"):
        ConfigLoader.load(config_file)


def test_load_config_missing_required_fields(tmp_path):
    """Test loading config with missing required fields."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text("""
github:
  repo_owner: "test"
  # Missing repo_name and target_repo_path
""")
    
    with pytest.raises(ConfigError):
        ConfigLoader.load(config_file)


def test_validate_nonexistent_repo_path(tmp_path):
    """Test validation fails for nonexistent repo path."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text("""
github:
  repo_owner: "test"
  repo_name: "test-repo"
  target_repo_path: "/nonexistent/path"
whiteboard:
  path: "whiteboard/whiteboard.md"
logging:
  log_file: "logs/test.log"
""")
    
    with pytest.raises(ConfigError, match="Target repo path does not exist"):
        ConfigLoader.load(config_file)


def test_validate_invalid_log_level(tmp_path):
    """Test validation fails for invalid log level."""
    # Create a git repo
    repo_path = tmp_path / "repo"
    repo_path.mkdir()
    (repo_path / ".git").mkdir()
    
    config_file = tmp_path / "config.yaml"
    config_file.write_text(f"""
github:
  repo_owner: "test"
  repo_name: "test-repo"
  target_repo_path: "{repo_path}"
whiteboard:
  path: "{tmp_path}/whiteboard.md"
logging:
  log_file: "{tmp_path}/test.log"
  log_level: "INVALID"
""")
    
    with pytest.raises(ConfigError, match="Invalid log level"):
        ConfigLoader.load(config_file)


def test_load_valid_config(tmp_path):
    """Test loading valid configuration."""
    # Create a git repo
    repo_path = tmp_path / "repo"
    repo_path.mkdir()
    (repo_path / ".git").mkdir()
    
    config_file = tmp_path / "config.yaml"
    config_file.write_text(f"""
github:
  repo_owner: "test-owner"
  repo_name: "test-repo"
  target_repo_path: "{repo_path}"

labels:
  queue_label: "my-queue"
  processing_label: "processing"
  await_plan_label: "awaiting"
  completed_label: "done"
  failed_label: "failed"
  revising_label: "revising"

agent_mapping:
  "bug": "bug-agent"
  "feature": "feature-agent"

execution:
  auto_approve: true
  concurrency: 2
  approval_comment: "/ok"
  revise_comment: "/redo"
  timeout: 1800

whiteboard:
  path: "{tmp_path}/whiteboard.md"
  lock_timeout: 1800

logging:
  log_file: "{tmp_path}/test.log"
  log_level: "DEBUG"

cron:
  schedule: "*/5 * * * *"
  enabled: true
""")
    
    config = ConfigLoader.load(config_file)
    
    assert isinstance(config, Config)
    assert config.github.repo_owner == "test-owner"
    assert config.github.repo_name == "test-repo"
    assert config.labels.queue_label == "my-queue"
    assert config.execution.auto_approve is True
    assert config.execution.concurrency == 2
    assert config.agent_mapping["bug"] == "bug-agent"

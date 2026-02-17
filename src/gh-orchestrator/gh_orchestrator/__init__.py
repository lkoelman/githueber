"""GitHub Orchestrator - Automated GitHub issue orchestration with OpenCode agents."""

__version__ = "1.0.0"
__author__ = "OpenCode"

from .processor import IssueProcessor
from .config import ConfigLoader, ConfigError
from .models import Config

__all__ = [
    'IssueProcessor',
    'ConfigLoader',
    'ConfigError',
    'Config',
]

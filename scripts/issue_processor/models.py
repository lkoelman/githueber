"""Data models for the issue processor."""

from dataclasses import dataclass, field
from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum


class IssueState(Enum):
    """Possible states for an issue during processing."""
    QUEUED = "queued"
    PROCESSING = "processing"
    AWAITING_PLAN = "awaiting_plan"
    REVISING = "revising"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class GitHubConfig:
    """GitHub repository configuration."""
    repo_owner: str
    repo_name: str
    target_repo_path: str
    
    @property
    def repo_fullname(self) -> str:
        """Get full repository name (owner/repo)."""
        return f"{self.repo_owner}/{self.repo_name}"


@dataclass
class Labels:
    """Label configuration for issue tracking."""
    queue_label: str = "agent-queue"
    processing_label: str = "agent-processing"
    await_plan_label: str = "await-plan"
    completed_label: str = "agent-completed"
    failed_label: str = "agent-failed"
    revising_label: str = "agent-revising"


@dataclass
class ExecutionConfig:
    """Execution configuration."""
    auto_approve: bool = False
    concurrency: int = 1
    approval_comment: str = "/approve"
    revise_comment: str = "/revise"
    opencode_model: Optional[str] = None
    timeout: int = 3600  # seconds


@dataclass
class WhiteboardConfig:
    """Whiteboard configuration."""
    path: str
    lock_timeout: int = 3600


@dataclass
class LoggingConfig:
    """Logging configuration."""
    log_file: str
    log_level: str = "INFO"


@dataclass
class CronConfig:
    """CRON configuration."""
    schedule: str = "*/15 * * * *"
    enabled: bool = True


@dataclass
class Config:
    """Main configuration."""
    github: GitHubConfig
    labels: Labels
    agent_mapping: Dict[str, str]
    execution: ExecutionConfig
    whiteboard: WhiteboardConfig
    logging: LoggingConfig
    cron: CronConfig


@dataclass
class Issue:
    """GitHub issue representation."""
    number: int
    title: str
    body: str
    labels: List[str]
    url: str
    created_at: datetime
    updated_at: datetime
    
    def has_label(self, label: str) -> bool:
        """Check if issue has a specific label."""
        return label in self.labels
    
    def __str__(self) -> str:
        return f"Issue #{self.number}: {self.title}"


@dataclass
class Comment:
    """GitHub issue comment."""
    id: int
    body: str
    author: str
    created_at: datetime
    updated_at: datetime
    
    def is_approval(self, approval_prefix: str) -> bool:
        """Check if comment is an approval."""
        return self.body.strip().startswith(approval_prefix)
    
    def is_revision_request(self, revise_prefix: str) -> bool:
        """Check if comment is a revision request."""
        return self.body.strip().startswith(revise_prefix)
    
    def extract_modifications(self, approval_prefix: str) -> Optional[str]:
        """Extract text after approval command."""
        if self.is_approval(approval_prefix):
            text = self.body.strip()[len(approval_prefix):].strip()
            return text if text else None
        return None
    
    def extract_revision_feedback(self, revise_prefix: str) -> str:
        """Extract revision feedback from comment."""
        if self.is_revision_request(revise_prefix):
            return self.body.strip()[len(revise_prefix):].strip()
        return ""


@dataclass
class ProcessingResult:
    """Result of processing an issue."""
    success: bool
    issue: Issue
    agent_name: Optional[str]
    output: str
    error: Optional[str] = None
    duration: float = 0.0
    
    def __str__(self) -> str:
        status = "✅ Success" if self.success else "❌ Failed"
        agent = f" (agent: {self.agent_name})" if self.agent_name else ""
        return f"{status}: {self.issue}{agent} - {self.duration:.1f}s"


@dataclass
class PlanResult:
    """Result of generating a plan."""
    success: bool
    issue: Issue
    plan: str
    error: Optional[str] = None
    
    def __str__(self) -> str:
        status = "✅ Plan generated" if self.success else "❌ Plan failed"
        return f"{status} for {self.issue}"

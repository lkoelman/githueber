"""Whiteboard manager for state tracking."""

import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List


logger = logging.getLogger(__name__)


class Whiteboard:
    """Manage whiteboard markdown file for state tracking."""
    
    def __init__(self, whiteboard_path: Path):
        """
        Initialize whiteboard manager.
        
        Args:
            whiteboard_path: Path to whiteboard file
        """
        self.path = whiteboard_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        
        if not self.path.exists():
            self._initialize()
    
    def _initialize(self) -> None:
        """Create initial whiteboard file."""
        logger.info(f"Initializing whiteboard: {self.path}")
        
        template = """# Issue Processing Whiteboard

## Lock Status
- **Locked:** No
- **Process ID:** N/A
- **Timestamp:** N/A

## Active Jobs
| Issue | Status | Started | Agent/Mode |
|-------|--------|---------|------------|

## Recent Completions (Last 20)
| Issue | Status | Completed | Duration | Agent/Mode |
|-------|--------|-----------|----------|------------|

## Recent Failures (Last 20)
| Issue | Error | Failed At | Agent/Mode |
|-------|-------|-----------|------------|

---
Last updated: {timestamp}
""".format(timestamp=datetime.now().isoformat())
        
        self.path.write_text(template)
    
    def add_active_job(self, issue_number: int, agent_name: Optional[str]) -> None:
        """
        Add job to active section.
        
        Args:
            issue_number: Issue number
            agent_name: Agent name or None for plan/build mode
        """
        mode = agent_name if agent_name else "plan/build"
        entry = (
            f"| #{issue_number} | Processing | "
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {mode} |"
        )
        
        logger.debug(f"Adding active job: {entry}")
        self._append_to_section("Active Jobs", entry)
    
    def move_to_completed(
        self,
        issue_number: int,
        duration: float,
        agent_name: Optional[str]
    ) -> None:
        """
        Move job from active to completed.
        
        Args:
            issue_number: Issue number
            duration: Processing duration in seconds
            agent_name: Agent name or None
        """
        self._remove_from_section("Active Jobs", f"#{issue_number}")
        
        mode = agent_name if agent_name else "plan/build"
        entry = (
            f"| #{issue_number} | Success | "
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | "
            f"{duration:.1f}s | {mode} |"
        )
        
        logger.debug(f"Moving to completed: {entry}")
        self._append_to_section("Recent Completions", entry, max_entries=20)
    
    def move_to_failed(
        self,
        issue_number: int,
        error: str,
        agent_name: Optional[str]
    ) -> None:
        """
        Move job from active to failed.
        
        Args:
            issue_number: Issue number
            error: Error message
            agent_name: Agent name or None
        """
        self._remove_from_section("Active Jobs", f"#{issue_number}")
        
        mode = agent_name if agent_name else "plan/build"
        error_short = error[:50] + "..." if len(error) > 50 else error
        error_escaped = error_short.replace('|', '\\|')  # Escape pipes for markdown
        
        entry = (
            f"| #{issue_number} | {error_escaped} | "
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {mode} |"
        )
        
        logger.debug(f"Moving to failed: {entry}")
        self._append_to_section("Recent Failures", entry, max_entries=20)
    
    def _append_to_section(
        self,
        section: str,
        entry: str,
        max_entries: Optional[int] = None
    ) -> None:
        """
        Append entry to a section.
        
        Args:
            section: Section name
            entry: Entry to append
            max_entries: Maximum entries to keep in section
        """
        try:
            content = self.path.read_text()
            lines = content.split('\n')
            
            # Find section
            section_start = None
            for i, line in enumerate(lines):
                if section in line and line.startswith('##'):
                    section_start = i
                    break
            
            if section_start is None:
                logger.warning(f"Section '{section}' not found in whiteboard")
                return
            
            # Find table start (skip header and separator)
            table_start = section_start + 3
            
            # Find next section or end
            table_end = len(lines)
            for i in range(table_start, len(lines)):
                if lines[i].startswith('##') or lines[i].startswith('---'):
                    table_end = i
                    break
            
            # Insert entry at start of table
            lines.insert(table_start, entry)
            
            # Limit entries if needed
            if max_entries:
                # Count entries in section (lines starting with |, excluding header separator)
                entries = []
                for i in range(table_start, min(table_end + 1, len(lines))):
                    if lines[i].startswith('| #'):
                        entries.append(i)
                
                # Remove excess entries (oldest at the end)
                if len(entries) > max_entries:
                    to_remove = entries[max_entries:]
                    for idx in reversed(to_remove):
                        del lines[idx]
            
            # Update timestamp
            for i in range(len(lines) - 1, -1, -1):
                if lines[i].startswith('Last updated:'):
                    lines[i] = f"Last updated: {datetime.now().isoformat()}"
                    break
            
            self.path.write_text('\n'.join(lines))
            
        except Exception as e:
            logger.error(f"Failed to append to whiteboard: {e}")
    
    def _remove_from_section(self, section: str, pattern: str) -> None:
        """
        Remove entry matching pattern from section.
        
        Args:
            section: Section name
            pattern: Pattern to match for removal
        """
        try:
            content = self.path.read_text()
            lines = content.split('\n')
            
            # Remove lines containing pattern that start with |
            filtered_lines = []
            for line in lines:
                if pattern in line and line.startswith('|'):
                    logger.debug(f"Removing line: {line}")
                    continue
                filtered_lines.append(line)
            
            # Update timestamp
            for i in range(len(filtered_lines) - 1, -1, -1):
                if filtered_lines[i].startswith('Last updated:'):
                    filtered_lines[i] = f"Last updated: {datetime.now().isoformat()}"
                    break
            
            self.path.write_text('\n'.join(filtered_lines))
            
        except Exception as e:
            logger.error(f"Failed to remove from whiteboard: {e}")

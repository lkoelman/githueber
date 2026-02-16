"""GitHub API client using gh CLI."""

import json
import subprocess
import logging
from typing import List, Optional
from datetime import datetime

from .models import Issue, Comment


logger = logging.getLogger(__name__)


class GitHubError(Exception):
    """GitHub API error."""
    pass


class GitHubClient:
    """GitHub API client using gh CLI."""
    
    def __init__(self, repo_owner: str, repo_name: str):
        """
        Initialize GitHub client.
        
        Args:
            repo_owner: Repository owner/organization
            repo_name: Repository name
        """
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.repo = f"{repo_owner}/{repo_name}"
        
        # Verify gh CLI is available
        try:
            subprocess.run(['gh', '--version'], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise GitHubError("gh CLI not found. Install from https://cli.github.com/")
    
    def _run_gh(self, args: List[str]) -> str:
        """
        Run gh CLI command.
        
        Args:
            args: Command arguments
            
        Returns:
            Command stdout
            
        Raises:
            GitHubError: If command fails
        """
        cmd = ['gh'] + args
        logger.debug(f"Running: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr or e.stdout or "Unknown error"
            logger.error(f"gh command failed: {error_msg}")
            raise GitHubError(f"gh command failed: {error_msg}")
    
    def fetch_issues_by_label(self, label: str) -> List[Issue]:
        """
        Fetch open issues with specific label.
        
        Args:
            label: Label to filter by
            
        Returns:
            List of issues
        """
        logger.info(f"Fetching issues with label '{label}' from {self.repo}")
        
        output = self._run_gh([
            'issue', 'list',
            '--repo', self.repo,
            '--label', label,
            '--state', 'open',
            '--json', 'number,title,body,labels,url,createdAt,updatedAt'
        ])
        
        if not output.strip():
            logger.debug(f"No issues found with label '{label}'")
            return []
        
        try:
            issues_data = json.loads(output)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse issues JSON: {e}")
            raise GitHubError(f"Failed to parse issues: {e}")
        
        issues = []
        for issue_data in issues_data:
            try:
                issue = Issue(
                    number=issue_data['number'],
                    title=issue_data['title'],
                    body=issue_data.get('body', ''),
                    labels=[label['name'] for label in issue_data['labels']],
                    url=issue_data['url'],
                    created_at=self._parse_timestamp(issue_data['createdAt']),
                    updated_at=self._parse_timestamp(issue_data['updatedAt'])
                )
                issues.append(issue)
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse issue: {e}")
                continue
        
        logger.info(f"Found {len(issues)} issue(s) with label '{label}'")
        return issues
    
    def fetch_comments(self, issue_number: int, since: Optional[datetime] = None) -> List[Comment]:
        """
        Fetch comments on an issue.
        
        Args:
            issue_number: Issue number
            since: Only return comments after this timestamp
            
        Returns:
            List of comments
        """
        logger.debug(f"Fetching comments for issue #{issue_number}")
        
        output = self._run_gh([
            'api',
            f'/repos/{self.repo}/issues/{issue_number}/comments',
            '--jq', '.'
        ])
        
        if not output.strip():
            return []
        
        try:
            comments_data = json.loads(output)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse comments JSON: {e}")
            raise GitHubError(f"Failed to parse comments: {e}")
        
        comments = []
        for comment_data in comments_data:
            try:
                created_at = self._parse_timestamp(comment_data['created_at'])
                
                # Skip if before 'since' timestamp
                if since and created_at <= since:
                    continue
                
                comment = Comment(
                    id=comment_data['id'],
                    body=comment_data['body'],
                    author=comment_data['user']['login'],
                    created_at=created_at,
                    updated_at=self._parse_timestamp(comment_data['updated_at'])
                )
                comments.append(comment)
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse comment: {e}")
                continue
        
        logger.debug(f"Found {len(comments)} comment(s)")
        return comments
    
    def update_labels(
        self,
        issue_number: int,
        remove_labels: Optional[List[str]] = None,
        add_labels: Optional[List[str]] = None
    ) -> None:
        """
        Update issue labels.
        
        Args:
            issue_number: Issue number
            remove_labels: Labels to remove
            add_labels: Labels to add
        """
        remove_labels = remove_labels or []
        add_labels = add_labels or []
        
        if not remove_labels and not add_labels:
            return
        
        logger.info(
            f"Updating labels for issue #{issue_number}: "
            f"remove={remove_labels}, add={add_labels}"
        )
        
        args = ['issue', 'edit', str(issue_number), '--repo', self.repo]
        
        for label in remove_labels:
            args.extend(['--remove-label', label])
        
        for label in add_labels:
            args.extend(['--add-label', label])
        
        try:
            self._run_gh(args)
            logger.debug(f"Labels updated successfully for issue #{issue_number}")
        except GitHubError as e:
            logger.error(f"Failed to update labels: {e}")
            raise
    
    def post_comment(self, issue_number: int, body: str) -> None:
        """
        Post a comment on an issue.
        
        Args:
            issue_number: Issue number
            body: Comment body
        """
        logger.info(f"Posting comment to issue #{issue_number}")
        logger.debug(f"Comment body: {body[:100]}...")
        
        try:
            self._run_gh([
                'issue', 'comment', str(issue_number),
                '--repo', self.repo,
                '--body', body
            ])
            logger.debug(f"Comment posted successfully to issue #{issue_number}")
        except GitHubError as e:
            logger.error(f"Failed to post comment: {e}")
            raise
    
    @staticmethod
    def _parse_timestamp(timestamp_str: str) -> datetime:
        """
        Parse ISO timestamp from GitHub API.
        
        Args:
            timestamp_str: ISO timestamp string
            
        Returns:
            datetime object
        """
        # GitHub returns timestamps like "2024-01-01T12:00:00Z"
        return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))

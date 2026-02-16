"""Workflow management for different processing modes."""

import logging
import time
from typing import Optional
from datetime import datetime

from .models import Config, Issue
from .github_client import GitHubClient, GitHubError
from .opencode_runner import OpenCodeRunner, OpenCodeError
from .whiteboard import Whiteboard


logger = logging.getLogger(__name__)


class WorkflowManager:
    """Manage different processing workflows."""
    
    def __init__(
        self,
        config: Config,
        github: GitHubClient,
        opencode: OpenCodeRunner,
        whiteboard: Whiteboard
    ):
        """
        Initialize workflow manager.
        
        Args:
            config: Configuration
            github: GitHub client
            opencode: OpenCode runner
            whiteboard: Whiteboard manager
        """
        self.config = config
        self.github = github
        self.opencode = opencode
        self.whiteboard = whiteboard
    
    def run_with_agent(self, issue: Issue, agent_name: str) -> None:
        """
        Execute issue with specific agent.
        
        Args:
            issue: Issue to process
            agent_name: Agent name to use
        """
        logger.info(f"Running {issue} with agent '{agent_name}'")
        
        # Update labels
        try:
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.queue_label],
                add_labels=[self.config.labels.processing_label]
            )
        except GitHubError as e:
            logger.error(f"Failed to update labels: {e}")
            return
        
        # Add to whiteboard
        self.whiteboard.add_active_job(issue.number, agent_name)
        
        # Prepare prompt
        prompt = f"{issue.title}\n\n{issue.body}"
        
        # Execute OpenCode
        start_time = time.time()
        try:
            output = self.opencode.run_with_agent(
                agent_name,
                prompt,
                timeout=self.config.execution.timeout
            )
            
            duration = time.time() - start_time
            
            # Success
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.processing_label],
                add_labels=[self.config.labels.completed_label]
            )
            
            # Extract summary from output
            summary = self.opencode.extract_build_output(output)
            
            self.github.post_comment(
                issue.number,
                f"✅ Issue processed successfully by agent `{agent_name}`\n\n"
                f"Duration: {duration:.1f}s\n\n"
                f"**Summary:**\n{summary[:500]}"
            )
            
            self.whiteboard.move_to_completed(issue.number, duration, agent_name)
            logger.info(f"{issue} completed successfully in {duration:.1f}s")
            
        except OpenCodeError as e:
            self._handle_error(issue, agent_name, str(e))
        except GitHubError as e:
            logger.error(f"GitHub error after processing: {e}")
            self._handle_error(issue, agent_name, str(e))
    
    def run_plan_build(self, issue: Issue) -> None:
        """
        Execute plan/build workflow.
        
        Args:
            issue: Issue to process
        """
        logger.info(f"Running {issue} in plan/build mode")
        
        # Update labels
        try:
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.queue_label],
                add_labels=[self.config.labels.processing_label]
            )
        except GitHubError as e:
            logger.error(f"Failed to update labels: {e}")
            return
        
        # Add to whiteboard
        self.whiteboard.add_active_job(issue.number, None)
        
        # Run plan mode
        start_time = time.time()
        try:
            plan_output = self.opencode.run_plan_mode(
                issue.title,
                issue.body,
                timeout=self.config.execution.timeout
            )
            
            plan = self.opencode.extract_plan(plan_output)
            
            # Post plan as comment
            approval_text = (
                "✅ Auto-approving and proceeding to build..."
                if self.config.execution.auto_approve
                else f"❓ Reply with `{self.config.execution.approval_comment}` to proceed, "
                     f"or `{self.config.execution.revise_comment} <feedback>` to revise the plan."
            )
            
            self.github.post_comment(
                issue.number,
                f"📋 **Plan Generated**\n\n{plan}\n\n---\n{approval_text}"
            )
            
            if self.config.execution.auto_approve:
                # Auto-approve: proceed to build
                logger.info("Auto-approving plan and proceeding to build")
                
                build_output = self.opencode.run_build_mode(
                    plan,
                    timeout=self.config.execution.timeout
                )
                
                duration = time.time() - start_time
                
                # Success
                self.github.update_labels(
                    issue.number,
                    remove_labels=[self.config.labels.processing_label],
                    add_labels=[self.config.labels.completed_label]
                )
                
                build_summary = self.opencode.extract_build_output(build_output)
                
                self.github.post_comment(
                    issue.number,
                    f"✅ Plan executed successfully!\n\n"
                    f"Total duration: {duration:.1f}s\n\n"
                    f"**Summary:**\n{build_summary[:500]}"
                )
                
                self.whiteboard.move_to_completed(issue.number, duration, None)
                logger.info(f"{issue} completed (plan+build) in {duration:.1f}s")
                
            else:
                # Manual approval: wait for user
                self.github.update_labels(
                    issue.number,
                    remove_labels=[self.config.labels.processing_label],
                    add_labels=[self.config.labels.await_plan_label]
                )
                logger.info(f"{issue} awaiting plan approval")
                
        except OpenCodeError as e:
            self._handle_error(issue, None, str(e))
        except GitHubError as e:
            logger.error(f"GitHub error during plan/build: {e}")
            self._handle_error(issue, None, str(e))
    
    def check_and_process_approval(self, issue: Issue) -> None:
        """
        Check for approval/revision comments and process accordingly.
        
        Args:
            issue: Issue awaiting approval
        """
        logger.info(f"Checking approval status for {issue}")
        
        # Fetch recent comments
        try:
            comments = self.github.fetch_comments(issue.number, since=issue.updated_at)
        except GitHubError as e:
            logger.error(f"Failed to fetch comments: {e}")
            return
        
        if not comments:
            logger.debug(f"No new comments on {issue}")
            return
        
        # Check for approval or revision (process most recent first)
        for comment in reversed(comments):
            if comment.is_approval(self.config.execution.approval_comment):
                logger.info(f"Found approval comment on {issue}")
                modifications = comment.extract_modifications(self.config.execution.approval_comment)
                self._execute_approved_plan(issue, modifications)
                return
            
            elif comment.is_revision_request(self.config.execution.revise_comment):
                logger.info(f"Found revision request on {issue}")
                feedback = comment.extract_revision_feedback(self.config.execution.revise_comment)
                self._revise_plan(issue, feedback)
                return
    
    def _execute_approved_plan(self, issue: Issue, modifications: Optional[str]) -> None:
        """
        Execute build mode with approved plan.
        
        Args:
            issue: Issue with approved plan
            modifications: Optional modifications from approval comment
        """
        logger.info(f"Executing approved plan for {issue}")
        
        # Extract plan from previous comments
        try:
            comments = self.github.fetch_comments(issue.number)
        except GitHubError as e:
            logger.error(f"Failed to fetch comments: {e}")
            return
        
        plan = None
        for comment in reversed(comments):
            if "Plan Generated" in comment.body or "Updated Plan" in comment.body:
                # Extract plan (between header and separator)
                parts = comment.body.split("---")
                if parts:
                    plan_text = parts[0]
                    # Remove header
                    plan_lines = plan_text.split('\n')
                    plan_lines = [l for l in plan_lines if not l.startswith('📋')]
                    plan = '\n'.join(plan_lines).strip()
                    break
        
        if not plan:
            logger.error(f"Could not find plan in {issue} comments")
            self.github.post_comment(
                issue.number,
                "❌ Error: Could not find plan to execute. Please create a new issue."
            )
            return
        
        # Update labels
        try:
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.await_plan_label],
                add_labels=[self.config.labels.processing_label]
            )
        except GitHubError as e:
            logger.error(f"Failed to update labels: {e}")
            return
        
        # Execute build
        start_time = time.time()
        try:
            build_output = self.opencode.run_build_mode(
                plan,
                modifications=modifications,
                timeout=self.config.execution.timeout
            )
            
            duration = time.time() - start_time
            
            # Success
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.processing_label],
                add_labels=[self.config.labels.completed_label]
            )
            
            mod_note = f"\n\n**Modifications applied:**\n{modifications}" if modifications else ""
            build_summary = self.opencode.extract_build_output(build_output)
            
            self.github.post_comment(
                issue.number,
                f"✅ Plan executed successfully!{mod_note}\n\n"
                f"Duration: {duration:.1f}s\n\n"
                f"**Summary:**\n{build_summary[:500]}"
            )
            
            self.whiteboard.move_to_completed(issue.number, duration, None)
            logger.info(f"{issue} build completed in {duration:.1f}s")
            
        except OpenCodeError as e:
            self._handle_error(issue, None, str(e))
        except GitHubError as e:
            logger.error(f"GitHub error during build: {e}")
            self._handle_error(issue, None, str(e))
    
    def _revise_plan(self, issue: Issue, feedback: str) -> None:
        """
        Revise plan based on feedback.
        
        Args:
            issue: Issue to revise
            feedback: Revision feedback
        """
        logger.info(f"Revising plan for {issue}")
        
        # Update labels
        try:
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.await_plan_label],
                add_labels=[self.config.labels.revising_label]
            )
        except GitHubError as e:
            logger.error(f"Failed to update labels: {e}")
            return
        
        # Run plan mode with feedback
        try:
            plan_output = self.opencode.run_plan_mode(
                issue.title,
                issue.body,
                feedback=feedback,
                timeout=self.config.execution.timeout
            )
            
            plan = self.opencode.extract_plan(plan_output)
            
            # Post updated plan
            self.github.post_comment(
                issue.number,
                f"📋 **Updated Plan** (based on feedback)\n\n{plan}\n\n---\n"
                f"Reply with `{self.config.execution.approval_comment}` to proceed, "
                f"or `{self.config.execution.revise_comment} <feedback>` for further revisions."
            )
            
            # Update labels
            self.github.update_labels(
                issue.number,
                remove_labels=[self.config.labels.revising_label],
                add_labels=[self.config.labels.await_plan_label]
            )
            
            logger.info(f"Revised plan posted for {issue}")
            
        except OpenCodeError as e:
            self._handle_error(issue, None, str(e))
        except GitHubError as e:
            logger.error(f"GitHub error during revision: {e}")
            self._handle_error(issue, None, str(e))
    
    def _handle_error(self, issue: Issue, agent_name: Optional[str], error: str) -> None:
        """
        Handle processing errors.
        
        Args:
            issue: Issue that failed
            agent_name: Agent name or None
            error: Error message
        """
        logger.error(f"Error processing {issue}: {error}")
        
        # Update labels
        current_labels = [
            self.config.labels.processing_label,
            self.config.labels.revising_label,
            self.config.labels.await_plan_label
        ]
        
        try:
            self.github.update_labels(
                issue.number,
                remove_labels=current_labels,
                add_labels=[self.config.labels.failed_label]
            )
        except GitHubError as e:
            logger.error(f"Failed to update failure labels: {e}")
        
        # Post error comment
        agent_note = f" (agent: `{agent_name}`)" if agent_name else ""
        try:
            self.github.post_comment(
                issue.number,
                f"❌ Processing failed{agent_note}\n\n"
                f"**Error:**\n```\n{error[:1000]}\n```\n\n"
                f"Please check the logs or retry manually."
            )
        except GitHubError as e:
            logger.error(f"Failed to post error comment: {e}")
        
        # Update whiteboard
        self.whiteboard.move_to_failed(issue.number, error, agent_name)

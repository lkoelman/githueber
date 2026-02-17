"""Main issue processor coordinator."""

import logging
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from .models import Config, Issue
from .github_client import GitHubClient
from .opencode_runner import OpenCodeRunner
from .whiteboard import Whiteboard
from .workflows import WorkflowManager


logger = logging.getLogger(__name__)


class IssueProcessor:
    """Main issue processing coordinator."""

    def __init__(self, config: Config):
        """
        Initialize issue processor.

        Args:
            config: Configuration
        """
        self.config = config

        # Initialize components
        self.github = GitHubClient(config.github.repo_owner, config.github.repo_name)

        self.opencode = OpenCodeRunner(
            Path(config.github.target_repo_path), config.execution.opencode_model
        )

        self.whiteboard = Whiteboard(Path(config.whiteboard.path))

        self.workflow = WorkflowManager(
            config, self.github, self.opencode, self.whiteboard
        )

    def run(self) -> None:
        """Main processing loop."""
        logger.info("=" * 60)
        logger.info("Starting issue processing run")
        logger.info("=" * 60)

        # Fetch issues
        logger.info(f"Fetching issues with label '{self.config.labels.queue_label}'")
        queue_issues: list[Issue] = self.github.fetch_issues_by_label(
            self.config.labels.queue_label
        )

        logger.info(
            f"Fetching issues with label '{self.config.labels.await_plan_label}'"
        )
        await_plan_issues: list[Issue] = self.github.fetch_issues_by_label(
            self.config.labels.await_plan_label
        )

        logger.info(
            f"Found {len(queue_issues)} queued issue(s), "
            f"{len(await_plan_issues)} awaiting plan approval"
        )

        # Process approval checks first (faster, no OpenCode execution)
        if await_plan_issues:
            logger.info("Processing approval checks...")
            for issue in await_plan_issues:
                try:
                    self.workflow.check_and_process_approval(issue)
                except Exception as e:
                    logger.error(
                        f"Error processing approval for {issue}: {e}", exc_info=True
                    )

        # Process new issues
        if not queue_issues:
            logger.info("No new issues to process")
        elif self.config.execution.concurrency == 1:
            # Sequential processing
            logger.info("Processing issues sequentially...")
            for issue in queue_issues:
                try:
                    self._process_issue(issue)
                except Exception as e:
                    logger.error(f"Error processing {issue}: {e}", exc_info=True)
        else:
            # Parallel processing
            logger.info(
                f"Processing issues in parallel "
                f"(concurrency={self.config.execution.concurrency})..."
            )
            with ThreadPoolExecutor(
                max_workers=self.config.execution.concurrency
            ) as executor:
                futures = {
                    executor.submit(self._process_issue, issue): issue
                    for issue in queue_issues
                }

                for future in as_completed(futures):
                    issue = futures[future]
                    try:
                        future.result()
                    except Exception as e:
                        logger.error(f"Error processing {issue}: {e}", exc_info=True)

        logger.info("=" * 60)
        logger.info("Issue processing run completed")
        logger.info("=" * 60)

    def _process_issue(self, issue: Issue) -> None:
        """
        Process a single issue.

        Args:
            issue: Issue to process
        """
        logger.info(f"Processing {issue}")

        # Determine agent
        agent_name = self._determine_agent(issue)

        if agent_name:
            # Direct agent execution
            logger.info(f"{issue} will use agent '{agent_name}'")
            self.workflow.run_with_agent(issue, agent_name)
        else:
            # Plan/build workflow
            logger.info(f"{issue} will use plan/build mode")
            self.workflow.run_plan_build(issue)

    def _determine_agent(self, issue: Issue) -> Optional[str]:
        """
        Determine which agent to use based on labels.

        Args:
            issue: Issue to check

        Returns:
            Agent name or None for plan/build mode
        """
        for label in issue.labels:
            if label in self.config.agent_mapping:
                agent_name = self.config.agent_mapping[label]
                logger.debug(
                    f"{issue} mapped to agent '{agent_name}' via label '{label}'"
                )
                return agent_name

        logger.debug(f"{issue} has no agent mapping")
        return None

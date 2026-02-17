"""OpenCode execution wrapper."""

import subprocess
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List


logger = logging.getLogger(__name__)


class OpenCodeError(Exception):
    """OpenCode execution error."""
    pass


class OpenCodeRunner:
    """Execute OpenCode with various configurations."""
    
    def __init__(self, repo_path: Path, model: Optional[str] = None):
        """
        Initialize OpenCode runner.
        
        Args:
            repo_path: Path to repository for OpenCode execution
            model: Optional model override
        """
        self.repo_path = repo_path
        self.model = model
        
        # Verify opencode is available
        try:
            subprocess.run(['opencode', '--version'], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise OpenCodeError("opencode not found. Install from https://opencode.ai/")
    
    def run_with_agent(
        self,
        agent_name: str,
        prompt: str,
        timeout: Optional[int] = None
    ) -> str:
        """
        Run OpenCode with specific agent.
        
        Args:
            agent_name: Name of agent to use
            prompt: Prompt to send to OpenCode
            timeout: Timeout in seconds
            
        Returns:
            OpenCode output
            
        Raises:
            OpenCodeError: If execution fails
        """
        cmd = [
            'opencode', 'run',
            '--agent', agent_name,
            '--dir', str(self.repo_path),
            '--format', 'json',
            prompt
        ]
        
        if self.model:
            cmd.extend(['--model', self.model])
        
        logger.info(f"Running OpenCode with agent '{agent_name}' in {self.repo_path}")
        logger.debug(f"Command: {' '.join(cmd)}")
        logger.debug(f"Prompt: {prompt[:100]}...")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=True,
                cwd=str(self.repo_path)
            )
            
            logger.debug(f"OpenCode completed successfully")
            return result.stdout
            
        except subprocess.TimeoutExpired:
            error_msg = f"OpenCode timed out after {timeout}s"
            logger.error(error_msg)
            raise OpenCodeError(error_msg)
        except subprocess.CalledProcessError as e:
            error_msg = f"OpenCode failed with exit code {e.returncode}"
            if e.stderr:
                error_msg += f": {e.stderr}"
            logger.error(error_msg)
            raise OpenCodeError(error_msg)
    
    def run_plan_mode(
        self,
        issue_title: str,
        issue_body: str,
        feedback: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> str:
        """
        Run OpenCode in plan mode.
        
        Args:
            issue_title: Issue title
            issue_body: Issue body
            feedback: Optional feedback for plan revision
            timeout: Timeout in seconds
            
        Returns:
            Plan output
        """
        prompt = f"Please analyze this issue and create a plan:\n\nTitle: {issue_title}\n\n{issue_body}"
        
        if feedback:
            prompt += f"\n\nFeedback/Revision Request:\n{feedback}"
        
        logger.info("Running OpenCode in plan mode")
        return self.run_with_agent('plan', prompt, timeout)
    
    def run_build_mode(
        self,
        plan: str,
        modifications: Optional[str] = None,
        timeout: Optional[int] = None
    ) -> str:
        """
        Run OpenCode in build mode.
        
        Args:
            plan: Plan to execute
            modifications: Optional modifications to apply
            timeout: Timeout in seconds
            
        Returns:
            Build output
        """
        prompt = f"Execute the following plan:\n\n{plan}"
        
        if modifications:
            prompt += f"\n\nWith these modifications:\n{modifications}"
        
        logger.info("Running OpenCode in build mode")
        return self.run_with_agent('build', prompt, timeout)
    
    def parse_json_output(self, output: str) -> List[Dict[str, Any]]:
        """
        Parse JSON output from OpenCode.
        
        Args:
            output: Raw output from OpenCode
            
        Returns:
            List of parsed JSON objects
        """
        try:
            # Output is JSONL (one JSON object per line)
            lines = output.strip().split('\n')
            results = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    obj = json.loads(line)
                    results.append(obj)
                except json.JSONDecodeError:
                    # Skip non-JSON lines
                    logger.debug(f"Skipping non-JSON line: {line[:50]}...")
                    continue
            
            return results
            
        except Exception as e:
            logger.warning(f"Failed to parse OpenCode output: {e}")
            return [{"raw_output": output}]
    
    def extract_plan(self, plan_output: str) -> str:
        """
        Extract plan text from OpenCode plan mode output.
        
        NOTE: This is a placeholder implementation. The actual format depends on
        OpenCode's output format which needs to be tested. Update this method
        based on actual output.
        
        Args:
            plan_output: Raw plan output
            
        Returns:
            Extracted plan text
        """
        logger.debug("Extracting plan from output")
        
        # Try to parse as JSON
        parsed = self.parse_json_output(plan_output)
        
        # Strategy 1: Look for messages with 'text' or 'content' type
        plan_parts = []
        for item in parsed:
            if isinstance(item, dict):
                # Look for text content
                if 'content' in item:
                    plan_parts.append(str(item['content']))
                elif 'text' in item:
                    plan_parts.append(str(item['text']))
                elif 'message' in item:
                    plan_parts.append(str(item['message']))
        
        if plan_parts:
            plan = '\n'.join(plan_parts)
            logger.debug(f"Extracted plan ({len(plan)} chars)")
            return plan
        
        # Strategy 2: If no structured data found, use raw output
        logger.warning("Could not extract structured plan, using raw output")
        
        # Try to clean up raw output
        lines = plan_output.strip().split('\n')
        clean_lines = []
        for line in lines:
            # Skip lines that look like JSON
            if line.strip().startswith('{') or line.strip().startswith('['):
                continue
            clean_lines.append(line)
        
        if clean_lines:
            return '\n'.join(clean_lines)
        
        # Fallback: return entire output
        return plan_output
    
    def extract_build_output(self, build_output: str) -> str:
        """
        Extract relevant information from build mode output.
        
        Args:
            build_output: Raw build output
            
        Returns:
            Extracted summary
        """
        # Similar to plan extraction, but looking for completion messages
        parsed = self.parse_json_output(build_output)
        
        # Extract meaningful messages
        messages = []
        for item in parsed:
            if isinstance(item, dict):
                if 'content' in item:
                    messages.append(str(item['content']))
                elif 'message' in item:
                    messages.append(str(item['message']))
        
        if messages:
            return '\n'.join(messages)
        
        return "Build completed (check repository for changes)"

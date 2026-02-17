"""CLI interface for GitHub Orchestrator."""

import argparse
import logging
import sys
from pathlib import Path

from .config import ConfigLoader, ConfigError
from .processor import IssueProcessor
from .lock_manager import LockManager, LockError


def setup_logging(log_file: str, log_level: str) -> None:
    """
    Configure logging.
    
    Args:
        log_file: Path to log file
        log_level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    level = getattr(logging, log_level.upper(), logging.INFO)
    
    # Create formatters
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_formatter = logging.Formatter(
        '%(levelname)s: %(message)s'
    )
    
    # Ensure log directory exists
    Path(log_file).parent.mkdir(parents=True, exist_ok=True)
    
    # File handler
    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(level)
    file_handler.setFormatter(file_formatter)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(console_formatter)
    
    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)


def main() -> int:
    """
    Main CLI entry point.
    
    Returns:
        Exit code (0 for success, non-zero for error)
    """
    parser = argparse.ArgumentParser(
        description="GitHub Orchestrator - Automated GitHub issue orchestration with OpenCode",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --config config/gh-orchestrator-config.yaml
  %(prog)s --config myconfig.yaml --dry-run
  %(prog)s --config myconfig.yaml --no-lock
"""
    )
    
    parser.add_argument(
        '--config',
        type=Path,
        default=Path('config/gh-orchestrator-config.yaml'),
        help='Path to configuration file (default: config/gh-orchestrator-config.yaml)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run in dry-run mode (no changes made) - NOT YET IMPLEMENTED'
    )
    
    parser.add_argument(
        '--no-lock',
        action='store_true',
        help='Skip lock acquisition (for testing only)'
    )
    
    parser.add_argument(
        '--version',
        action='version',
        version='%(prog)s 1.0.0'
    )
    
    args = parser.parse_args()
    
    # Load configuration
    try:
        config = ConfigLoader.load(args.config)
    except ConfigError as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Failed to load configuration: {e}", file=sys.stderr)
        return 1
    
    # Setup logging
    try:
        setup_logging(config.logging.log_file, config.logging.log_level)
    except Exception as e:
        print(f"Failed to setup logging: {e}", file=sys.stderr)
        return 1
    
    logger = logging.getLogger(__name__)
    
    logger.info("=" * 60)
    logger.info("GitHub Orchestrator Starting")
    logger.info("=" * 60)
    logger.info(f"Configuration: {args.config}")
    logger.info(f"Repository: {config.github.repo_fullname}")
    logger.info(f"Target path: {config.github.target_repo_path}")
    logger.info(f"Concurrency: {config.execution.concurrency}")
    logger.info(f"Auto-approve: {config.execution.auto_approve}")
    
    if args.dry_run:
        logger.warning("DRY RUN MODE - This feature is not yet implemented")
        # TODO: Implement dry-run mode
    
    # Process issues with optional locking
    exit_code = 0
    
    if not args.no_lock:
        # Normal mode: acquire lock
        lock_path = Path(config.whiteboard.path).with_suffix('.lock')
        lock_manager = LockManager(lock_path, config.whiteboard.lock_timeout)
        
        try:
            with lock_manager.locked():
                logger.info("Lock acquired, starting processing")
                processor = IssueProcessor(config)
                processor.run()
        except LockError as e:
            logger.error(f"Failed to acquire lock: {e}")
            logger.error("Another instance may be running, or a stale lock exists")
            exit_code = 1
        except Exception as e:
            logger.error(f"Unexpected error during processing: {e}", exc_info=True)
            exit_code = 1
    else:
        # Testing mode: skip lock
        logger.warning("Running WITHOUT lock (--no-lock mode)")
        try:
            processor = IssueProcessor(config)
            processor.run()
        except Exception as e:
            logger.error(f"Unexpected error during processing: {e}", exc_info=True)
            exit_code = 1
    
    if exit_code == 0:
        logger.info("GitHub Orchestrator Completed Successfully")
    else:
        logger.error("GitHub Orchestrator Completed With Errors")
    
    return exit_code


if __name__ == '__main__':
    sys.exit(main())

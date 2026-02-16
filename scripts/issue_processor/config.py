"""Configuration loader and validator."""

import yaml
from pathlib import Path
from typing import Dict, Any

from .models import (
    Config,
    GitHubConfig,
    Labels,
    ExecutionConfig,
    WhiteboardConfig,
    LoggingConfig,
    CronConfig
)


class ConfigError(Exception):
    """Configuration error."""
    pass


class ConfigLoader:
    """Load and validate YAML configuration."""
    
    @staticmethod
    def load(config_path: Path) -> Config:
        """
        Load configuration from YAML file.
        
        Args:
            config_path: Path to YAML configuration file
            
        Returns:
            Validated Config object
            
        Raises:
            ConfigError: If configuration is invalid or file not found
        """
        if not config_path.exists():
            raise ConfigError(f"Config file not found: {config_path}")
        
        try:
            with open(config_path, 'r') as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise ConfigError(f"Invalid YAML: {e}")
        
        if not isinstance(data, dict):
            raise ConfigError("Configuration must be a YAML dictionary")
        
        # Build configuration objects
        try:
            config = Config(
                github=ConfigLoader._parse_github(data.get('github', {})),
                labels=ConfigLoader._parse_labels(data.get('labels', {})),
                agent_mapping=data.get('agent_mapping', {}),
                execution=ConfigLoader._parse_execution(data.get('execution', {})),
                whiteboard=ConfigLoader._parse_whiteboard(data.get('whiteboard', {})),
                logging=ConfigLoader._parse_logging(data.get('logging', {})),
                cron=ConfigLoader._parse_cron(data.get('cron', {}))
            )
        except (KeyError, TypeError, ValueError) as e:
            raise ConfigError(f"Invalid configuration: {e}")
        
        # Validate configuration
        ConfigLoader._validate(config)
        
        return config
    
    @staticmethod
    def _parse_github(data: Dict[str, Any]) -> GitHubConfig:
        """Parse GitHub configuration."""
        required = ['repo_owner', 'repo_name', 'target_repo_path']
        for field in required:
            if field not in data:
                raise ConfigError(f"Missing required field: github.{field}")
        
        return GitHubConfig(
            repo_owner=data['repo_owner'],
            repo_name=data['repo_name'],
            target_repo_path=data['target_repo_path']
        )
    
    @staticmethod
    def _parse_labels(data: Dict[str, Any]) -> Labels:
        """Parse labels configuration."""
        return Labels(**data)
    
    @staticmethod
    def _parse_execution(data: Dict[str, Any]) -> ExecutionConfig:
        """Parse execution configuration."""
        return ExecutionConfig(**data)
    
    @staticmethod
    def _parse_whiteboard(data: Dict[str, Any]) -> WhiteboardConfig:
        """Parse whiteboard configuration."""
        if 'path' not in data:
            raise ConfigError("Missing required field: whiteboard.path")
        
        return WhiteboardConfig(**data)
    
    @staticmethod
    def _parse_logging(data: Dict[str, Any]) -> LoggingConfig:
        """Parse logging configuration."""
        if 'log_file' not in data:
            raise ConfigError("Missing required field: logging.log_file")
        
        return LoggingConfig(**data)
    
    @staticmethod
    def _parse_cron(data: Dict[str, Any]) -> CronConfig:
        """Parse CRON configuration."""
        return CronConfig(**data)
    
    @staticmethod
    def _validate(config: Config) -> None:
        """
        Validate configuration values.
        
        Args:
            config: Configuration to validate
            
        Raises:
            ConfigError: If configuration is invalid
        """
        # Validate target repo path
        repo_path = Path(config.github.target_repo_path)
        if not repo_path.exists():
            raise ConfigError(f"Target repo path does not exist: {repo_path}")
        
        if not (repo_path / '.git').exists():
            raise ConfigError(f"Target repo path is not a git repository: {repo_path}")
        
        # Ensure log directory exists or can be created
        log_path = Path(config.logging.log_file)
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise ConfigError(f"Cannot create log directory: {e}")
        
        # Ensure whiteboard directory exists or can be created
        whiteboard_path = Path(config.whiteboard.path)
        try:
            whiteboard_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise ConfigError(f"Cannot create whiteboard directory: {e}")
        
        # Validate log level
        valid_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if config.logging.log_level.upper() not in valid_levels:
            raise ConfigError(
                f"Invalid log level: {config.logging.log_level}. "
                f"Must be one of: {', '.join(valid_levels)}"
            )
        
        # Validate concurrency
        if config.execution.concurrency < 1:
            raise ConfigError("Concurrency must be at least 1")
        
        # Validate timeout
        if config.execution.timeout < 1:
            raise ConfigError("Timeout must be at least 1 second")
        
        # Validate lock timeout
        if config.whiteboard.lock_timeout < 1:
            raise ConfigError("Lock timeout must be at least 1 second")
        
        # Validate agent mapping
        if not isinstance(config.agent_mapping, dict):
            raise ConfigError("agent_mapping must be a dictionary")

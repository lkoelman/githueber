"""File-based locking for coordination."""

import fcntl
import os
import time
import logging
from pathlib import Path
from contextlib import contextmanager
from typing import Optional


logger = logging.getLogger(__name__)


class LockError(Exception):
    """Lock acquisition error."""
    pass


class LockManager:
    """File-based locking using fcntl."""
    
    def __init__(self, lock_path: Path, timeout: int = 3600):
        """
        Initialize lock manager.
        
        Args:
            lock_path: Path to lock file
            timeout: Lock acquisition timeout in seconds
        """
        self.lock_path = lock_path
        self.timeout = timeout
        self.lock_fd: Optional[int] = None
    
    def acquire(self) -> bool:
        """
        Acquire lock with timeout.
        
        Returns:
            True if lock acquired, False if timeout
        """
        logger.info(f"Attempting to acquire lock: {self.lock_path}")
        
        # Ensure lock directory exists
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            # Open or create lock file
            self.lock_fd = os.open(
                str(self.lock_path),
                os.O_CREAT | os.O_WRONLY | os.O_TRUNC
            )
            
            # Try to acquire lock with timeout
            start_time = time.time()
            while time.time() - start_time < self.timeout:
                try:
                    # Non-blocking exclusive lock
                    fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    
                    # Write lock metadata
                    lock_info = (
                        f"PID={os.getpid()}\n"
                        f"TIMESTAMP={time.time()}\n"
                        f"HOSTNAME={os.uname().nodename}\n"
                    )
                    os.write(self.lock_fd, lock_info.encode())
                    os.fsync(self.lock_fd)
                    
                    logger.info("Lock acquired successfully")
                    return True
                    
                except BlockingIOError:
                    # Lock is held by another process
                    time.sleep(1)
                    continue
            
            # Timeout
            logger.warning(f"Lock acquisition timed out after {self.timeout}s")
            if self.lock_fd is not None:
                os.close(self.lock_fd)
                self.lock_fd = None
            return False
            
        except Exception as e:
            logger.error(f"Failed to acquire lock: {e}")
            if self.lock_fd is not None:
                try:
                    os.close(self.lock_fd)
                except:
                    pass
                self.lock_fd = None
            return False
    
    def release(self) -> None:
        """Release lock."""
        if self.lock_fd is None:
            logger.warning("Attempted to release lock that was not acquired")
            return
        
        try:
            fcntl.flock(self.lock_fd, fcntl.LOCK_UN)
            os.close(self.lock_fd)
            logger.info("Lock released")
        except Exception as e:
            logger.error(f"Failed to release lock: {e}")
        finally:
            self.lock_fd = None
    
    @contextmanager
    def locked(self):
        """
        Context manager for lock acquisition.
        
        Usage:
            with lock_manager.locked():
                # do work
                pass
        
        Raises:
            LockError: If lock cannot be acquired
        """
        acquired = self.acquire()
        if not acquired:
            raise LockError(f"Failed to acquire lock within {self.timeout}s")
        
        try:
            yield
        finally:
            self.release()
    
    def __enter__(self):
        """Context manager entry."""
        if not self.acquire():
            raise LockError(f"Failed to acquire lock within {self.timeout}s")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.release()
        return False

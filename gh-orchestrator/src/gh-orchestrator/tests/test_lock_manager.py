"""Tests for lock manager."""

import pytest
from pathlib import Path
from gh_orchestrator.lock_manager import LockManager, LockError


def test_acquire_and_release_lock(tmp_path):
    """Test basic lock acquisition and release."""
    lock_path = tmp_path / "test.lock"
    manager = LockManager(lock_path, timeout=5)
    
    assert manager.acquire()
    assert lock_path.exists()
    
    manager.release()


def test_lock_context_manager(tmp_path):
    """Test lock using context manager."""
    lock_path = tmp_path / "test.lock"
    manager = LockManager(lock_path, timeout=5)
    
    with manager.locked():
        assert lock_path.exists()


def test_lock_context_manager_timeout(tmp_path):
    """Test lock timeout with context manager."""
    lock_path = tmp_path / "test.lock"
    
    # First manager holds the lock
    manager1 = LockManager(lock_path, timeout=5)
    manager1.acquire()
    
    # Second manager should timeout
    manager2 = LockManager(lock_path, timeout=1)
    with pytest.raises(LockError):
        with manager2.locked():
            pass
    
    # Cleanup
    manager1.release()


def test_lock_prevents_concurrent_access(tmp_path):
    """Test that lock prevents concurrent access."""
    lock_path = tmp_path / "test.lock"
    
    manager1 = LockManager(lock_path, timeout=5)
    manager2 = LockManager(lock_path, timeout=1)
    
    # First acquire succeeds
    assert manager1.acquire()
    
    # Second acquire fails (timeout)
    assert not manager2.acquire()
    
    # After release, second acquire succeeds
    manager1.release()
    assert manager2.acquire()
    
    # Cleanup
    manager2.release()

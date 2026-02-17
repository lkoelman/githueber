#!/usr/bin/env python3
"""Setup script for installing CRON job."""

import subprocess
import sys
import argparse
from pathlib import Path


def check_command(cmd: str) -> bool:
    """Check if command exists in PATH."""
    try:
        subprocess.run(['which', cmd], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError:
        return False


def check_dependencies() -> bool:
    """Check for required dependencies."""
    print("🔍 Checking dependencies...")
    
    required = {
        'gh': 'GitHub CLI - https://cli.github.com/',
        'opencode': 'OpenCode - https://opencode.ai/',
        'python3': 'Python 3.9+',
    }
    
    missing = []
    for cmd, description in required.items():
        if not check_command(cmd):
            missing.append(f"  ❌ {cmd}: {description}")
        else:
            print(f"  ✅ {cmd}")
    
    if missing:
        print("\n❌ Missing required dependencies:")
        print("\n".join(missing))
        return False
    
    # Check Python version
    if sys.version_info < (3, 9):
        print(f"❌ Python 3.9+ required (found {sys.version_info.major}.{sys.version_info.minor})")
        return False
    
    print("✅ All dependencies found")
    return True


def install_python_deps() -> bool:
    """Install Python dependencies."""
    requirements = Path(__file__).parent / 'requirements.txt'
    if not requirements.exists():
        print("⚠️  requirements.txt not found, skipping pip install")
        return True
    
    print("\n📦 Installing Python dependencies...")
    try:
        subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', str(requirements)],
            check=True
        )
        print("✅ Python dependencies installed")
        return True
    except subprocess.CalledProcessError:
        print("❌ Failed to install Python dependencies")
        return False


def check_gh_auth() -> bool:
    """Check GitHub CLI authentication."""
    print("\n🔐 Checking GitHub CLI authentication...")
    try:
        subprocess.run(['gh', 'auth', 'status'], check=True, capture_output=True)
        print("✅ GitHub CLI authenticated")
        return True
    except subprocess.CalledProcessError:
        print("❌ GitHub CLI not authenticated")
        print("   Run: gh auth login")
        return False


def setup_cron(config_path: Path, schedule: str) -> bool:
    """Setup CRON job."""
    # Get absolute paths
    base_dir = Path(__file__).parent.resolve()
    config_path = config_path.resolve()
    python_bin = sys.executable
    
    # CRON command
    cron_cmd = (
        f"{schedule} cd {base_dir} && "
        f"{python_bin} -m gh_orchestrator --config {config_path} "
        f">> {base_dir}/logs/cron.log 2>&1"
    )
    
    print(f"\n📅 CRON job command:")
    print(f"   {cron_cmd}")
    print()
    
    response = input("❓ Install CRON job now? [y/N]: ")
    if response.lower() != 'y':
        print("\nℹ️  CRON job not installed. To install manually, run:")
        print(f"   (crontab -l 2>/dev/null; echo '{cron_cmd}') | crontab -")
        return True
    
    try:
        # Get existing crontab
        result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""
        
        # Check if job already exists
        if cron_cmd in existing:
            print("ℹ️  CRON job already installed")
            return True
        
        # Add new job
        new_crontab = existing.rstrip() + f"\n{cron_cmd}\n"
        subprocess.run(['crontab', '-'], input=new_crontab, text=True, check=True)
        print("✅ CRON job installed successfully")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install CRON job: {e}")
        return False


def main():
    """Main setup function."""
    parser = argparse.ArgumentParser(
        description="Setup GitHub Orchestrator CRON job",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '--config',
        type=Path,
        default=Path('config/gh-orchestrator-config.yaml'),
        help='Path to configuration file (default: config/gh-orchestrator-config.yaml)'
    )
    parser.add_argument(
        '--skip-deps',
        action='store_true',
        help='Skip dependency checks'
    )
    
    args = parser.parse_args()
    
    print("🔧 GitHub Orchestrator Setup")
    print("=" * 60)
    
    # Check dependencies
    if not args.skip_deps:
        if not check_dependencies():
            return 1
        
        if not install_python_deps():
            return 1
        
        if not check_gh_auth():
            return 1
    
    # Validate config
    print(f"\n📝 Configuration: {args.config}")
    if not args.config.exists():
        print(f"❌ Config file not found: {args.config}")
        print("   Create it from the example:")
        example = Path('config/gh-orchestrator-config.example.yaml')
        print(f"   cp {example} {args.config}")
        return 1
    
    print(f"✅ Configuration file found")
    
    # Load config to get schedule
    try:
        import yaml
        with open(args.config) as f:
            config = yaml.safe_load(f)
            schedule = config.get('cron', {}).get('schedule', '*/15 * * * *')
            enabled = config.get('cron', {}).get('enabled', True)
        
        if not enabled:
            print("\n⚠️  CRON is disabled in configuration (cron.enabled: false)")
            response = input("   Continue anyway? [y/N]: ")
            if response.lower() != 'y':
                print("Setup cancelled")
                return 0
    except Exception as e:
        print(f"⚠️  Could not read schedule from config: {e}")
        schedule = input("\nEnter CRON schedule (default: */15 * * * *): ").strip() or "*/15 * * * *"
    
    print(f"\n⏰ Schedule: {schedule}")
    
    # Setup CRON
    if not setup_cron(args.config, schedule):
        return 1
    
    print("\n" + "=" * 60)
    print("✅ Setup complete!")
    print("\nNext steps:")
    print(f"  1. Test manually: python -m gh_orchestrator --config {args.config}")
    print("  2. Check logs: tail -f logs/gh-orchestrator.log")
    print("  3. View CRON log: tail -f logs/cron.log")
    print("  4. View whiteboard: cat whiteboard/whiteboard.md")
    print("  5. List CRON jobs: crontab -l")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

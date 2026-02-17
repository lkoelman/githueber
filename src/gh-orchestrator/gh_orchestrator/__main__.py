"""Main entry point for running as module: python -m gh_orchestrator"""

import sys
from .cli import main

if __name__ == '__main__':
    sys.exit(main())

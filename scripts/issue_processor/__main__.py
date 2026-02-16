"""Main entry point for running as module: python -m issue_processor"""

import sys
from .cli import main

if __name__ == '__main__':
    sys.exit(main())

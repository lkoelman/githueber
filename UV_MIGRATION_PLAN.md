# UV Migration Plan: Restructure to `src/gh-orchestrator`

## Overview
Restructure the repository to follow modern Python packaging best practices:
- Move package from `scripts/issue_processor` to `src/gh-orchestrator/gh_orchestrator`
- Rename package: `issue_processor` → `gh_orchestrator`
- Rename CLI command: `issue-processor` → `gh-orchestrator`
- Use `uv` as the package manager and build system
- Consolidate all dependency management into `pyproject.toml`
- Remove legacy `setup.py` and `requirements.txt` files

## Target Directory Structure

```
agents-config/
├── src/
│   └── gh-orchestrator/
│       ├── gh_orchestrator/          # Python package (underscore)
│       │   ├── __init__.py
│       │   ├── __main__.py
│       │   ├── cli.py
│       │   ├── config.py
│       │   ├── models.py
│       │   ├── github_client.py
│       │   ├── opencode_runner.py
│       │   ├── lock_manager.py
│       │   ├── whiteboard.py
│       │   ├── processor.py
│       │   ├── workflows.py
│       │   └── utils.py
│       ├── tests/                    # Tests inside package
│       │   ├── __init__.py
│       │   ├── test_config.py
│       │   ├── test_github_client.py
│       │   ├── test_lock_manager.py
│       │   └── test_workflows.py
│       └── setup_cron.py             # Setup script (part of package)
│
├── config/                           # Runtime config (stays at root)
│   ├── gh-orchestrator-config.yaml
│   └── gh-orchestrator-config.example.yaml
│
├── whiteboard/                       # Runtime data (stays at root)
│   └── whiteboard-template.md
│
├── logs/                             # Runtime logs (stays at root)
│
├── opencode/                         # Existing OpenCode configs
│   ├── agents/
│   └── skills/
│
├── pyproject.toml                    # Modern config (uv-based)
├── uv.lock                           # uv lock file (generated)
├── README.md                         # Updated docs
├── IMPLEMENTATION_NOTES.md
└── .gitignore                        # Updated
```

## Detailed Changes

### 1. Create New Directory Structure

**Actions:**
- Create `src/gh-orchestrator/` directory
- Create `src/gh-orchestrator/gh_orchestrator/` (Python package)
- Create `src/gh-orchestrator/tests/` directory

### 2. Move and Rename Package Files

**File Moves:**
```
scripts/issue_processor/*.py → src/gh-orchestrator/gh_orchestrator/*.py
```

**Files to move (12 files):**
- `__init__.py`
- `__main__.py`
- `cli.py`
- `config.py`
- `models.py`
- `github_client.py`
- `opencode_runner.py`
- `lock_manager.py`
- `whiteboard.py`
- `processor.py`
- `workflows.py`
- `utils.py`

### 3. Move Test Files

**File Moves:**
```
tests/*.py → src/gh-orchestrator/tests/*.py
```

**Files to move:**
- `test_config.py`
- `test_github_client.py`
- `test_lock_manager.py`
- `test_workflows.py`

**Update imports in tests:**
- Change: `from issue_processor.X import Y`
- To: `from gh_orchestrator.X import Y`

### 4. Move Setup Script

**File Move:**
```
setup-cron.py → src/gh-orchestrator/setup_cron.py
```

**Note:** Rename with underscore for Python module convention

### 5. Update Package Metadata

**In `src/gh-orchestrator/gh_orchestrator/__init__.py`:**
- Update `__version__`
- Update docstring references
- Update exports

### 6. Create New `pyproject.toml`

**Complete rewrite using uv build system:**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "gh-orchestrator"
version = "1.0.0"
description = "Automated GitHub issue orchestration with OpenCode agents"
readme = "README.md"
requires-python = ">=3.9"
license = {text = "MIT"}
authors = [
    {name = "OpenCode"}
]
keywords = ["github", "automation", "opencode", "ci", "orchestration"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "Topic :: Software Development :: Build Tools",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]

dependencies = [
    "PyYAML>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.0",
    "pytest-cov>=4.0",
]

[project.scripts]
gh-orchestrator = "gh_orchestrator.cli:main"

[project.urls]
Homepage = "https://github.com/your-org/agents-config"
Documentation = "https://github.com/your-org/agents-config/blob/main/README.md"
Repository = "https://github.com/your-org/agents-config"
Issues = "https://github.com/your-org/agents-config/issues"

[tool.hatch.build.targets.wheel]
packages = ["src/gh-orchestrator/gh_orchestrator"]

[tool.pytest.ini_options]
testpaths = ["src/gh-orchestrator/tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --strict-markers"

[tool.coverage.run]
source = ["gh_orchestrator"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
]
```

### 7. Rename Configuration Files

**File Renames:**
```
config/issue-processor-config.example.yaml → config/gh-orchestrator-config.example.yaml
```

**Update config file contents:**
- Update all comments/descriptions to reference "gh-orchestrator"
- Update example paths

### 8. Update Python Source Code

**All imports need updating:**

1. **Test files** (`src/gh-orchestrator/tests/*.py`):
   ```python
   # OLD
   from issue_processor.config import ConfigLoader
   # NEW
   from gh_orchestrator.config import ConfigLoader
   ```

2. **Relative imports** (no change needed - these still work)
   ```python
   from .config import ConfigLoader  # ✓ No change
   ```

3. **CLI script references** (`cli.py`):
   ```python
   # OLD in help text
   "GitHub Issue Processor - Automated issue processing"
   # NEW
   "GitHub Orchestrator - Automated GitHub issue orchestration with OpenCode"
   ```

4. **Logger names** (optional, for consistency):
   ```python
   # OLD
   logger = logging.getLogger(__name__)  # Creates issue_processor.cli
   # NEW - still works, but __name__ now = gh_orchestrator.cli
   ```

5. **String references in code:**
   - Update user-facing strings that mention "issue-processor"
   - Update log messages
   - Update error messages

### 9. Update Documentation

**README.md updates:**
- Replace all "Issue Processor" → "GitHub Orchestrator" (title)
- Replace all "issue-processor" → "gh-orchestrator" (CLI commands)
- Replace all "issue_processor" → "gh_orchestrator" (package references)
- Update installation instructions
- Update configuration file paths
- Update example commands

**Sections to update:**
- Title
- Quick Start commands
- Installation section
- Usage examples
- Configuration file paths
- Project structure diagram
- Troubleshooting commands

**IMPLEMENTATION_NOTES.md updates:**
- Update package name references
- Update installation commands
- Update test commands
- Update file paths

### 10. Update `.gitignore`

**Add:**
```
# uv
.venv/
uv.lock

# Old structure (no longer used)
scripts/issue_processor/
tests/test_*.py
requirements.txt
requirements-dev.txt
setup.py
```

**Update:**
- Config file ignore should now be `config/gh-orchestrator-config.yaml`

### 11. Delete Legacy Files

**Files to remove:**
- `setup.py` (replaced by pyproject.toml)
- `requirements.txt` (dependencies now in pyproject.toml)
- `requirements-dev.txt` (dev deps now in pyproject.toml)
- `scripts/` directory (entire directory, after moving files)
- `tests/` directory at root (after moving to src/)

### 12. Update Setup Script

**`src/gh-orchestrator/setup_cron.py` changes:**

1. **Update imports** (if importing from package):
   ```python
   # Add if needed
   from gh_orchestrator.config import ConfigLoader
   ```

2. **Update default config path:**
   ```python
   # OLD
   default=Path('config/issue-processor-config.yaml')
   # NEW
   default=Path('config/gh-orchestrator-config.yaml')
   ```

3. **Update CLI command in CRON:**
   ```python
   # OLD
   cron_cmd = f"{schedule} cd {base_dir} && {python_bin} -m issue_processor ..."
   # NEW
   cron_cmd = f"{schedule} cd {base_dir} && {python_bin} -m gh_orchestrator ..."
   ```

4. **Update help text and messages:**
   - "GitHub Issue Processor Setup" → "GitHub Orchestrator Setup"
   - References to "issue-processor" → "gh-orchestrator"

### 13. Installation & Usage with `uv`

**New installation flow:**

```bash
# Install uv (if not installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Clone/navigate to repo
cd agents-config

# Create virtual environment and install
uv venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
uv pip install -e .

# Or install with dev dependencies
uv pip install -e ".[dev]"

# Or using uv sync (if using uv.lock)
uv sync
```

**New CLI usage:**
```bash
# Run command
gh-orchestrator --config config/gh-orchestrator-config.yaml

# Or as module
python -m gh_orchestrator --config config/gh-orchestrator-config.yaml

# Run setup
python src/gh-orchestrator/setup_cron.py

# Or if installed as package
python -c "from gh_orchestrator.setup_cron import main; main()"
```

## Migration Checklist

### Phase 1: Structure Setup
- [ ] Create `src/gh-orchestrator/` directory
- [ ] Create `src/gh-orchestrator/gh_orchestrator/` directory
- [ ] Create `src/gh-orchestrator/tests/` directory

### Phase 2: Move Files
- [ ] Move 12 Python module files to `src/gh-orchestrator/gh_orchestrator/`
- [ ] Move test files to `src/gh-orchestrator/tests/`
- [ ] Move and rename `setup-cron.py` to `src/gh-orchestrator/setup_cron.py`

### Phase 3: Update Code
- [ ] Update imports in test files (`issue_processor` → `gh_orchestrator`)
- [ ] Update `__init__.py` metadata
- [ ] Update `cli.py` help text and messages
- [ ] Update `setup_cron.py` references
- [ ] Update any hardcoded strings referencing old package name

### Phase 4: Configuration
- [ ] Create new `pyproject.toml` with uv/hatchling build system
- [ ] Rename config example file
- [ ] Update config file contents/comments

### Phase 5: Documentation
- [ ] Update README.md (all references)
- [ ] Update IMPLEMENTATION_NOTES.md
- [ ] Update `.gitignore`

### Phase 6: Cleanup
- [ ] Delete `setup.py`
- [ ] Delete `requirements.txt`
- [ ] Delete `requirements-dev.txt`
- [ ] Delete `scripts/` directory
- [ ] Delete `tests/` directory at root

### Phase 7: Verification
- [ ] Run `uv pip install -e .` to test installation
- [ ] Run `gh-orchestrator --help` to test CLI
- [ ] Run `uv run pytest` to test all tests pass
- [ ] Test setup script: `python src/gh-orchestrator/setup_cron.py --help`
- [ ] Verify no broken imports

## Potential Issues & Solutions

### Issue 1: Import Errors After Rename
**Problem:** Old imports still reference `issue_processor`
**Solution:** Grep all files for `issue_processor` and replace with `gh_orchestrator`

### Issue 2: Relative Imports Break
**Problem:** Moving files changes relative import paths
**Solution:** Use absolute imports from `gh_orchestrator.*` or update relative imports

### Issue 3: Config Files Not Found
**Problem:** Hardcoded paths reference old config names
**Solution:** Update all path references in code, especially in `config.py` and `cli.py`

### Issue 4: CRON Job Points to Old Command
**Problem:** Existing CRON jobs reference `issue-processor`
**Solution:** Update CRON jobs manually or rerun setup script

### Issue 5: Tests Can't Find Package
**Problem:** Pytest can't import `gh_orchestrator`
**Solution:** Ensure `pyproject.toml` correctly specifies package location

## Testing Strategy

After migration:

1. **Unit Tests:**
   ```bash
   uv run pytest src/gh-orchestrator/tests/ -v
   ```

2. **CLI Test:**
   ```bash
   gh-orchestrator --help
   gh-orchestrator --version
   ```

3. **Module Import Test:**
   ```bash
   python -c "from gh_orchestrator import ConfigLoader; print('OK')"
   ```

4. **Installation Test:**
   ```bash
   uv pip install -e .
   which gh-orchestrator
   ```

5. **Setup Script Test:**
   ```bash
   python src/gh-orchestrator/setup_cron.py --help
   ```

## Benefits of New Structure

1. **Standard src-layout**: Follows Python packaging best practices
2. **Clear separation**: Source code vs. runtime data vs. tests
3. **Modern tooling**: uv is fast and handles everything
4. **Single source of truth**: pyproject.toml for all config
5. **Better naming**: "gh-orchestrator" better describes what it does
6. **Cleaner installs**: No accidental imports from repo root
7. **Professional structure**: Ready for PyPI publication if desired

## Estimated File Changes

- **Files to create**: 1 directory structure
- **Files to move**: ~17 (12 modules + tests + setup script)
- **Files to update**: ~15 (imports, docs, config)
- **Files to delete**: 5 (setup.py, requirements files, old dirs)
- **Total operations**: ~40

## Timeline Estimate

- **Planning**: Complete ✓
- **Execution**: 30-45 minutes (methodical file moves and updates)
- **Testing**: 15-20 minutes
- **Total**: ~1 hour

## Notes

- All relative imports (`.module`) will continue to work unchanged
- Config, whiteboard, and logs directories stay at repository root as runtime data
- Tests move inside the package for better organization
- Setup script becomes part of the package for easier distribution
- CLI command renamed from `issue-processor` to `gh-orchestrator` for clarity


# Rules

## Test-Driven Development (TDD) Workflow

**Strong preference for TDD**; Agent should guide this workflow proactively.

### TDD Steps

1. **Write failing test first** (before any implementation)
   - Add test case to appropriate test file in package
   - Run pytest to confirm test fails with expected error
   - Commit the failing test (optional but recommended for clarity)

2. **Implement minimal code to pass test**
   - Write only enough code to make the test pass
   - Avoid over-engineering or extra features

3. **Run tests again**
   - pytest should now pass
   - If not, iterate on implementation

4. **Refactor if needed**
   - Keep tests passing while improving code
   - Run pytest after each refactor

5. **Repeat for next behavior**

**When TDD is impractical:**
- Document why (e.g., characterization test requires understanding existing behavior first)
- Use characterization tests: write tests that capture current behavior, then refactor safely
- Still aim for test coverage of new/changed code

**Test coverage expectations:**
- New behavior: must have tests
- Bug fixes: add regression test that would have caught the bug
- Refactors: existing tests must still pass; add tests if coverage gaps exist


## Editing and Change Discipline

### Hard Rules

1. **Read before writing**: NEVER propose changes to code you haven't read. Use Read tool first.
2. **No surprise changes**: Only make changes directly requested or clearly necessary for the task.
3. **Smallest scope first**: Build/test single modules or packages before workspace-wide operations.

### What NOT to do (unless explicitly requested)

- Add features beyond what was asked
- Refactor surrounding code "while you're there"
- Add docstrings, comments, or type annotations to unchanged code
- Add error handling for scenarios that can't happen
- Create helpers/utilities for one-time operations
- Design for hypothetical future requirements
- Add backwards-compatibility hacks (e.g., renaming unused `_vars`, re-exporting types, `// removed` comments)
- Delete unused code without confirming it's truly unused

### Keep it simple

- Three similar lines of code > premature abstraction
- Only validate at system boundaries (user input, external APIs), not internal code
- Trust framework guarantees
- Don't use feature flags or backwards-compatibility shims when you can just change the code

## Git Conventions


**Commit workflow:**
- Agent proposes commit messages; user retains final edit/approval
- **NEVER commit, push, or run destructive git commands without explicit user permission**
- **NEVER update git config without explicit user permission**
- **NEVER run force push, hard reset, or other destructive git operations without explicit user approval**
- **NEVER skip hooks** (--no-verify, --no-gpg-sign) unless explicitly requested


## Documentation Maintenance

**Docs must stay in sync with code changes.**

When modifying code, check if these docs need updates:
- [README.md](README.md) - Overview, getting started, installation
- Module-specific README files (e.g., `<module>/**/README.md`)

**When to update docs:**
- New features: add how-to guide or update relevant README
- API changes: update module README and architecture docs
- Build/test changes: update this AGENTS.md or module-specific docs
- Deprecations: mark as deprecated in docs, add migration guide if needed

**Before committing**, ask: "Did I update the docs?"

## TypeScript Development

- use `bun` as the runtime, package manager, and bundler
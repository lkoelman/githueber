#!/usr/bin/env bash
set -euo pipefail

readonly REPO_OWNER="lkoelman"
readonly REPO_NAME="agents-config"
readonly DEFAULT_REF="main"
readonly DEFAULT_HARNESS="opencode"

AUTO_YES=0
HARNESS="$DEFAULT_HARNESS"
REF="$DEFAULT_REF"

usage() {
  cat <<'EOF'
Usage: curl -fsSL https://raw.githubusercontent.com/lkoelman/agents-config/main/install-githueber.sh | bash -s -- [options]

Options:
  --harness <opencode|codex|claude|gemini>  Install harness assets for the selected harness
  --ref <branch>                            Install from a different GitHub branch
  -y, --yes                                Auto-install missing dependencies without prompting
  -h, --help                               Show this help text
EOF
}

validate_harness() {
  local harness="${1:-}"

  case "$harness" in
    opencode|codex|claude|gemini)
      printf '%s\n' "$harness"
      ;;
    *)
      printf 'Unsupported harness: %s. Supported harnesses: opencode, codex, claude, gemini\n' "$harness" >&2
      return 1
      ;;
  esac
}

build_archive_url() {
  local ref="$1"
  printf 'https://codeload.github.com/%s/%s/tar.gz/refs/heads/%s\n' "$REPO_OWNER" "$REPO_NAME" "$ref"
}

resolve_gh_install_command() {
  if command -v brew >/dev/null 2>&1; then
    printf 'brew install gh\n'
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    printf 'sudo apt-get update && sudo apt-get install -y gh\n'
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    printf 'sudo dnf install -y gh\n'
    return 0
  fi

  if command -v pacman >/dev/null 2>&1; then
    printf 'sudo pacman -Sy --noconfirm github-cli\n'
    return 0
  fi

  return 1
}

resolve_bun_install_command() {
  printf 'curl -fsSL https://bun.sh/install | bash\n'
}

confirm() {
  local prompt="$1"

  if [[ "$AUTO_YES" -eq 1 ]]; then
    return 0
  fi

  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

run_command() {
  local command="$1"
  printf '==> %s\n' "$command"
  bash -lc "$command"
}

install_gh_if_missing() {
  if command -v gh >/dev/null 2>&1; then
    return 0
  fi

  local install_command
  if ! install_command="$(resolve_gh_install_command)"; then
    printf 'GitHub CLI (gh) is required, but no supported package manager was found. Install gh manually and rerun the installer.\n' >&2
    exit 1
  fi

  printf 'GitHub CLI (gh) is not installed.\n'
  if ! confirm "Install gh now?"; then
    printf 'Installation cancelled because gh is required.\n' >&2
    exit 1
  fi

  run_command "$install_command"
}

install_bun_if_missing() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi

  local install_command
  install_command="$(resolve_bun_install_command)"

  printf 'Bun is not installed.\n'
  if ! confirm "Install bun now?"; then
    printf 'Installation cancelled because bun is required.\n' >&2
    exit 1
  fi

  run_command "$install_command"
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
}

download_and_install() {
  local work_dir archive_path extracted_root package_dir archive_url
  work_dir="$(mktemp -d)"
  archive_path="$work_dir/$REPO_NAME.tar.gz"
  archive_url="$(build_archive_url "$REF")"

  trap 'rm -rf "$work_dir"' EXIT

  printf '==> Downloading %s\n' "$archive_url"
  curl -fsSL "$archive_url" -o "$archive_path"
  tar -xzf "$archive_path" -C "$work_dir"

  for extracted_root in "$work_dir"/agents-config-*; do
    if [[ -d "$extracted_root" ]]; then
      package_dir="$extracted_root/githueber"
      break
    fi
  done

  if [[ -z "${package_dir:-}" || ! -d "$package_dir" ]]; then
    printf 'Downloaded archive did not contain the githueber package.\n' >&2
    exit 1
  fi

  printf '==> Installing githueber from %s\n' "$REF"
  (
    cd "$package_dir"
    bun install
    bun run build:all
    bun link
    bun run dist/cli.js harness-install "$HARNESS"
  )
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --harness)
        if [[ $# -lt 2 ]]; then
          printf 'Missing value for --harness\n' >&2
          exit 1
        fi
        HARNESS="$(validate_harness "$2")"
        shift 2
        ;;
      --ref)
        if [[ $# -lt 2 ]]; then
          printf 'Missing value for --ref\n' >&2
          exit 1
        fi
        REF="$2"
        shift 2
        ;;
      -y|--yes)
        AUTO_YES=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n' "$1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  install_gh_if_missing
  install_bun_if_missing
  download_and_install

  printf '\nInstallation complete.\n'
  printf 'Installed harness assets for %s.\n' "$HARNESS"
  printf 'If you have not authenticated GitHub CLI yet, run: gh auth login\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
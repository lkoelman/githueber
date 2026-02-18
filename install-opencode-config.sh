#!/usr/bin/env bash
#
# install-opencode-config.sh
#
# Installs OpenCode agents and skills using GNU Stow
# This creates symlinks from ~/.opencode/ to this repository

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_NAME="opencode"
TARGET_DIR="$HOME"

echo -e "${BLUE}OpenCode Configuration Installer${NC}"
echo "=================================="
echo ""

# Check if GNU Stow is installed
if ! command -v stow &> /dev/null; then
    echo -e "${RED}Error: GNU Stow is not installed.${NC}"
    echo ""
    echo "Please install it first:"
    echo ""
    echo "  Debian/Ubuntu:  sudo apt-get install stow"
    echo "  macOS:          brew install stow"
    echo "  Arch Linux:     sudo pacman -S stow"
    echo "  Fedora/RHEL:    sudo dnf install stow"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} GNU Stow found: $(command -v stow)"
echo ""

# Check for existing manual symlinks
MANUAL_SYMLINKS=()
if [ -L "$HOME/.opencode/agents" ]; then
    MANUAL_SYMLINKS+=("$HOME/.opencode/agents")
fi
if [ -L "$HOME/.opencode/skills" ]; then
    MANUAL_SYMLINKS+=("$HOME/.opencode/skills")
fi

# If manual symlinks exist, ask to remove them
if [ ${#MANUAL_SYMLINKS[@]} -gt 0 ]; then
    echo -e "${YELLOW}Warning: Found existing manual symlinks:${NC}"
    for link in "${MANUAL_SYMLINKS[@]}"; do
        echo "  - $link -> $(readlink "$link")"
    done
    echo ""
    echo "These need to be removed before installing with Stow."
    read -p "Remove these symlinks now? [y/N] " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for link in "${MANUAL_SYMLINKS[@]}"; do
            echo "Removing: $link"
            rm "$link"
        done
        echo -e "${GREEN}✓${NC} Manual symlinks removed"
        echo ""
    else
        echo -e "${RED}Installation cancelled.${NC}"
        echo "Please remove the symlinks manually and try again:"
        for link in "${MANUAL_SYMLINKS[@]}"; do
            echo "  rm $link"
        done
        exit 1
    fi
fi

# Create ~/.opencode directory if it doesn't exist
if [ ! -d "$HOME/.opencode" ]; then
    echo "Creating directory: $HOME/.opencode"
    mkdir -p "$HOME/.opencode"
    echo -e "${GREEN}✓${NC} Directory created"
    echo ""
fi

# Change to the script directory
cd "$SCRIPT_DIR"

# Run stow
echo "Running: stow -v -R -t $TARGET_DIR $PACKAGE_NAME"
echo ""

if stow -v -R -t "$TARGET_DIR" "$PACKAGE_NAME" 2>&1; then
    echo ""
    echo -e "${GREEN}✓ Installation successful!${NC}"
    echo ""
    echo "OpenCode configurations have been installed:"
    echo "  ~/.opencode/agents/ -> $SCRIPT_DIR/$PACKAGE_NAME/.opencode/agents"
    echo "  ~/.opencode/skills/ -> $SCRIPT_DIR/$PACKAGE_NAME/.opencode/skills"
    echo ""
    
    # Verify installation
    if [ -d "$HOME/.opencode/agents" ] && [ -d "$HOME/.opencode/skills" ]; then
        echo -e "${GREEN}✓${NC} Verification passed"
        echo ""
        echo "Available agents:"
        ls -1 "$HOME/.opencode/agents/" 2>/dev/null | sed 's/^/  - /'
        echo ""
        echo "Available skills:"
        ls -1 "$HOME/.opencode/skills/" 2>/dev/null | sed 's/^/  - /'
        echo ""
    else
        echo -e "${YELLOW}Warning: Installation completed but verification failed.${NC}"
        echo "Please check ~/.opencode/ manually."
        echo ""
    fi
    
    echo "To uninstall, run: ./uninstall-opencode-config.sh"
    exit 0
else
    echo ""
    echo -e "${RED}✗ Installation failed!${NC}"
    echo ""
    echo "Common issues:"
    echo "  - Conflicting files exist in ~/.opencode/"
    echo "  - Permissions issue"
    echo ""
    echo "To see what files conflict, check the error message above."
    echo "You may need to backup or remove existing files in ~/.opencode/"
    echo ""
    exit 1
fi

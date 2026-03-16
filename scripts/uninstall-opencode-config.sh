#!/usr/bin/env bash
#
# uninstall-opencode-config.sh
#
# Uninstalls OpenCode agents and skills managed by GNU Stow
# This removes the symlinks from ~/.opencode/ that point to this repository

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

echo -e "${BLUE}OpenCode Configuration Uninstaller${NC}"
echo "===================================="
echo ""

# Check if GNU Stow is installed
if ! command -v stow &> /dev/null; then
    echo -e "${RED}Error: GNU Stow is not installed.${NC}"
    echo ""
    echo "Please install it first, or manually remove the symlinks:"
    echo "  rm ~/.opencode/agents ~/.opencode/skills"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} GNU Stow found: $(command -v stow)"
echo ""

# Check if the configuration is installed
if [ ! -L "$HOME/.opencode/agents" ] && [ ! -L "$HOME/.opencode/skills" ]; then
    echo -e "${YELLOW}Warning: No stow-managed symlinks found in ~/.opencode/${NC}"
    echo ""
    echo "The OpenCode configuration doesn't appear to be installed,"
    echo "or it was installed manually (not with stow)."
    echo ""
    
    # Check if directories exist but are not symlinks
    if [ -d "$HOME/.opencode/agents" ] || [ -d "$HOME/.opencode/skills" ]; then
        echo "Found directories (not symlinks) in ~/.opencode/:"
        [ -d "$HOME/.opencode/agents" ] && echo "  - ~/.opencode/agents/"
        [ -d "$HOME/.opencode/skills" ] && echo "  - ~/.opencode/skills/"
        echo ""
        echo "These were not created by stow and won't be removed."
    fi
    
    exit 0
fi

# Show what will be removed
echo "The following symlinks will be removed:"
[ -L "$HOME/.opencode/agents" ] && echo "  - ~/.opencode/agents -> $(readlink "$HOME/.opencode/agents")"
[ -L "$HOME/.opencode/skills" ] && echo "  - ~/.opencode/skills -> $(readlink "$HOME/.opencode/skills")"
echo ""

# Ask for confirmation
read -p "Proceed with uninstallation? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Uninstallation cancelled.${NC}"
    exit 0
fi

# Change to the script directory
cd "$SCRIPT_DIR"

# Run stow to remove
echo "Running: stow -v -D -t $TARGET_DIR $PACKAGE_NAME"
echo ""

if stow -v -D -t "$TARGET_DIR" "$PACKAGE_NAME" 2>&1; then
    echo ""
    echo -e "${GREEN}✓ Uninstallation successful!${NC}"
    echo ""
    
    # Verify removal
    if [ ! -L "$HOME/.opencode/agents" ] && [ ! -L "$HOME/.opencode/skills" ]; then
        echo -e "${GREEN}✓${NC} Verification passed - symlinks removed"
        echo ""
    else
        echo -e "${YELLOW}Warning: Some symlinks may still exist.${NC}"
        echo "Please check ~/.opencode/ manually."
        echo ""
    fi
    
    # Ask if they want to remove the entire ~/.opencode directory
    if [ -d "$HOME/.opencode" ]; then
        # Check if directory is empty (or only has .gitignore, etc.)
        if [ -z "$(ls -A "$HOME/.opencode" 2>/dev/null | grep -v '^\..*')" ]; then
            echo "The ~/.opencode/ directory is now empty (except for hidden files)."
            read -p "Remove the entire ~/.opencode/ directory? [y/N] " -n 1 -r
            echo ""
            
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                rm -rf "$HOME/.opencode"
                echo -e "${GREEN}✓${NC} Directory ~/.opencode/ removed"
                echo ""
            fi
        else
            echo "Note: ~/.opencode/ directory still contains other files/directories."
            echo "It has not been removed. Contents:"
            ls -la "$HOME/.opencode/" | tail -n +4 | sed 's/^/  /'
            echo ""
        fi
    fi
    
    echo "To reinstall, run: ./install-opencode-config.sh"
    exit 0
else
    echo ""
    echo -e "${RED}✗ Uninstallation failed!${NC}"
    echo ""
    echo "You may need to manually remove the symlinks:"
    echo "  rm ~/.opencode/agents ~/.opencode/skills"
    echo ""
    exit 1
fi

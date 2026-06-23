#!/usr/bin/env bash
set -e

echo "================================================="
echo "  JOURNALLER - AUTOMATED INSTALLATION SCRIPT"
echo "================================================="
echo ""

# 1. Check & Auto-Install System Dependencies
install_system_deps() {
    echo "Attempting to automatically install missing dependencies..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            echo "📦 macOS detected. Using Homebrew..."
            brew install node git
        else
            echo "❌ Homebrew is not installed. Please install Homebrew (https://brew.sh/) or download Node.js manually."
            exit 1
        fi
    elif command -v apt-get &> /dev/null; then
        echo "Debian/Ubuntu detected. Using apt-get (may ask for sudo password)..."
        sudo apt-get update
        sudo apt-get install -y nodejs npm git
    elif command -v dnf &> /dev/null; then
        echo "Fedora/RHEL detected. Using dnf (may ask for sudo password)..."
        sudo dnf install -y nodejs git
    elif command -v pacman &> /dev/null; then
        echo "Arch Linux detected. Using pacman (may ask for sudo password)..."
        sudo pacman -Sy --noconfirm nodejs npm git
    else
        echo "❌ Unsupported package manager. Please install Node.js and Git manually."
        exit 1
    fi
}

if ! command -v node &> /dev/null || ! command -v npm &> /dev/null || ! command -v git &> /dev/null; then
    echo "⚠️ Missing required system dependencies (Node.js, npm, or Git)."
    install_system_deps
fi

# 2. Clone Repository
SRC_DIR="$HOME/.journaller-src"
if [ -d "$SRC_DIR" ]; then
    echo "Existing installation found at $SRC_DIR. Updating..."
    cd "$SRC_DIR"
    git pull origin main
else
    echo "Downloading Journaller..."
    git clone https://github.com/theo-luttrell/journaller.git "$SRC_DIR"
    cd "$SRC_DIR"
fi

# 3. Install NPM Dependencies & Link globally
echo "Installing dependencies and linking the 'jnlr' executable..."
npm install
npm link

# 4. Interactive Editor Configuration
echo ""
echo "Step 2: Configure Text Editor"
echo "Journaller needs to know which text editor to open when you write an entry."
echo ""
echo "1) Nano    (Recommended for beginners. Terminal-based, easy to use)"
echo "2) VS Code (Graphical editor. Must have VS Code installed)"
echo "3) Vim     (Advanced. Terminal-based)"
echo "4) Skip    (I will configure my \$EDITOR variable manually)"
echo ""
read -p "Choose an option [1-4]: " editor_choice

SHELL_CONFIG="$HOME/.bashrc"
if [[ "$SHELL" == *"zsh"* ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
fi

case $editor_choice in
    1)
        echo -e '\n# Journaller Editor Config\nexport EDITOR="nano"' >> "$SHELL_CONFIG"
        echo "✅ Automatically configured Nano in $SHELL_CONFIG"
        ;;
    2)
        echo -e '\n# Journaller Editor Config\nexport EDITOR="code --wait"' >> "$SHELL_CONFIG"
        echo "✅ Automatically configured VS Code in $SHELL_CONFIG"
        echo "⚠️  Ensure you have installed the 'code' command in PATH via VS Code's Command Palette."
        ;;
    3)
        echo -e '\n# Journaller Editor Config\nexport EDITOR="vim"' >> "$SHELL_CONFIG"
        echo "✅ Automatically configured Vim in $SHELL_CONFIG"
        ;;
    *)
        echo "Skipped editor configuration."
        ;;
esac

# 5. Wrap up
echo ""
echo "================================================="
echo "🎉 INSTALLATION COMPLETE!"
echo "================================================="
echo ""
echo "To finalize the editor settings, please restart your terminal or run:"
echo "source $SHELL_CONFIG"
echo ""
echo "Then, initialize your vault by running:"
echo "journaller setup"
echo ""
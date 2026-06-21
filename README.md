# JOURNALLER

A strictly zero-knowledge, terminal-native journal built for speed and security. 

Journaller operates entirely from your command line, hands off writing to your preferred system editor (`vim`, `nano`, `code`), and locks your data using AES-256-GCM encryption. 

It features a strict **Blind Drop-Box Architecture**:
* **Write Mode (Auth PIN):** Can only create and encrypt new entries. It is mathematically incapable of reading past entries.
* **Vault Mode (Sudo PIN):** Required to decrypt, read, and manage the archival vault.

---

## Features

* **Terminal Native:** Zero browser overhead. Starts in milliseconds.
* **Bring Your Own Editor:** Writes are handled by your `$EDITOR` environment variable.
* **Military-Grade Cryptography:** Uses Node.js native `crypto` (AES-256-GCM) with unique salts for every key derivation.
* **In-Memory Operations:** Plain text is never written to disk outside of the temporary writing buffer, which is immediately destroyed upon encryption.
* **Recursive Search:** Easily organize your encrypted `.enc` files into subfolders; the read command can recursively scan and organize them chronologically.

---

## Installation

**Prerequisites:** You must have [Node.js](https://nodejs.org/) installed.

**1. Clone the repository:**
```bash
git clone https://github.com/theo-luttrell/journaller.git
cd journaller
```

**2. Install dependencies:**
```bash
npm install
```

**3. Link the executable:**
This binds the `jnlr` command globally so you can use it from any directory.
```bash
npm link
```

**4. Initialize your Vault:**
```bash
jnlr setup
```
*Follow the prompts to set your Sudo (Read) and Auth (Write) PINs. Your vault will be created securely at `~/.journaller/`.*

---

## Configuration (Crucial Step)

Journaller uses your system's `$EDITOR` variable to open a text editor when you create an entry. You must ensure this is set in your shell configuration file (`~/.zshrc` or `~/.bashrc`).

Add **one** of the following to the bottom of your shell config file:

**For Vim / Neovim:**
```bash
export EDITOR="vim"
```

**For Nano:**
```bash
export EDITOR="nano"
```

**For VS Code (GUI Editors):**
> [!warning]
> GUI editors require the wait flag, otherwise the terminal will not wait for you to finish typing before encrypting the file.*
```bash
export EDITOR="code --wait"
```

After updating your config, apply the changes:
```bash
source ~/.zshrc  # or ~/.bashrc
```

---

## Usage

Journaller supports shorthand aliases for maximum speed.

### 1. Write a New Entry
Opens your configured editor. When you save and quit, the file is instantly encrypted and the temporary plain-text file is permanently destroyed.
```bash
jnlr w
```
*(Or use: `jnlr write`)*

### 2. Read the Vault
Requires your Sudo PIN. Displays a chronological list of your encrypted sessions. It automatically scans subfolders recursively if you have manually organized your `.enc` files.
```bash
jnlr r
```
*(Or use: `jnlr read`)*

### 3. Setup / Reset
If you ever need to completely wipe and reset your vault keys (Warning: This will render existing `.enc` files unreadable if you lose the old keys).
```bash
jnlr s
```
*(Or use: `jnlr setup`)*

---

## Security Architecture Notes
* Journaller relies on a single **Master Secret Key (MSK)** generated upon setup.
* The MSK is encrypted twice and stored as two separate files (`msk_sudo.enc` and `msk_auth.enc`), each protected by a different PIN via `scryptSync`.
* This ensures that while symmetric AES-256-GCM encryption is used for the journal entries themselves, the UI logic can strictly enforce a "Write-Only" mode without exposing the read-capabilities to the Auth PIN holder.

#!/usr/bin/env node
const { Command } = require('commander');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const readline = require('readline');
const { Writable } = require('stream');
const AdmZip = require('adm-zip');

const program = new Command();
const VAULT_DIR = path.join(os.homedir(), '.journaller');

// ==========================================
// TERMINAL UI UTILS
// ==========================================
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m"
};

const askPin = (query) => {
    return new Promise(resolve => {
        const mutableStdout = new Writable({
            write: function(chunk, encoding, callback) {
                if (!this.muted) process.stdout.write(chunk, encoding);
                callback();
            }
        });
        const rl = readline.createInterface({
            input: process.stdin,
            output: mutableStdout,
            terminal: true
        });
        process.stdout.write(query);
        mutableStdout.muted = true;
        rl.question('', (password) => {
            process.stdout.write('\n');
            rl.close();
            resolve(password);
        });
    });
};

const askQuestion = (query) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
};

// ==========================================
// CRYPTOGRAPHY CORE (AES-256-GCM)
// ==========================================
const encryptData = (buffer, key) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
};

const decryptData = (buffer, key) => {
    try {
        const iv = buffer.subarray(0, 12);
        const tag = buffer.subarray(12, 28);
        const encrypted = buffer.subarray(28);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (e) {
        throw new Error("DECRYPTION_FAILED");
    }
};

const deriveKey = (pin, salt) => crypto.scryptSync(pin, salt, 32);

// ==========================================
// FILE SYSTEM HELPER
// ==========================================
const getFilesRecursive = (dir, fileList = [], baseDir = dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            getFilesRecursive(filepath, fileList, baseDir);
        } else {
            if (file.match(/^\d{4}-\d{2}-\d{2}-\d+\.enc$/)) {
                fileList.push(path.relative(baseDir, filepath));
            }
        }
    }
    return fileList;
};

// ==========================================
// CLI COMMANDS
// ==========================================

program
    .name('jnlr')
    .description('Zero-knowledge encrypted terminal journal')
    .version('2.1.0');

// 1. SETUP COMMAND
program
    .command('setup')
    .alias('s')
    .description('Initialize the vault and set PINs')
    .action(async () => {
        if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR);
        
        console.log(`${colors.cyan}INITIALIZING VAULT...${colors.reset}`);
        const sudoPin = await askPin("SET SUDO PIN (Admin/Read): ");
        const sudoConfirm = await askPin("CONFIRM SUDO PIN: ");
        if (sudoPin !== sudoConfirm) return console.log(`${colors.red}ERR: PINS DO NOT MATCH.${colors.reset}`);

        const authPin = await askPin("SET AUTH PIN (Write-Only): ");
        const authConfirm = await askPin("CONFIRM AUTH PIN: ");
        if (authPin !== authConfirm) return console.log(`${colors.red}ERR: PINS DO NOT MATCH.${colors.reset}`);

        const msk = crypto.randomBytes(32);

        const sudoSalt = crypto.randomBytes(16);
        const sudoKey = deriveKey(sudoPin, sudoSalt);
        fs.writeFileSync(path.join(VAULT_DIR, 'sudo_salt.bin'), sudoSalt);
        fs.writeFileSync(path.join(VAULT_DIR, 'msk_sudo.enc'), encryptData(msk, sudoKey));

        const authSalt = crypto.randomBytes(16);
        const authKey = deriveKey(authPin, authSalt);
        fs.writeFileSync(path.join(VAULT_DIR, 'auth_salt.bin'), authSalt);
        fs.writeFileSync(path.join(VAULT_DIR, 'msk_auth.enc'), encryptData(msk, authKey));

        console.log(`${colors.green}VAULT SECURED AT ${VAULT_DIR}${colors.reset}`);
    });

// 2. WRITE COMMAND
program
    .command('write')
    .alias('w')
    .description('Open system editor to write a new encrypted session')
    .action(async () => {
        if (!fs.existsSync(path.join(VAULT_DIR, 'msk_auth.enc'))) {
            return console.log(`${colors.red}ERR: VAULT NOT FOUND. RUN 'jnlr setup'${colors.reset}`);
        }

        const pin = await askPin("AUTH PIN: ");
        let msk;
        try {
            const authSalt = fs.readFileSync(path.join(VAULT_DIR, 'auth_salt.bin'));
            const encryptedMsk = fs.readFileSync(path.join(VAULT_DIR, 'msk_auth.enc'));
            const key = deriveKey(pin, authSalt);
            msk = decryptData(encryptedMsk, key);
        } catch (e) {
            return console.log(`${colors.red}ERR: UNAUTHORIZED${colors.reset}`);
        }

        const editorEnv = process.env.EDITOR || 'nano';
        const editorParts = editorEnv.split(' ');
        const editorCmd = editorParts[0];
        
        const tmpFile = path.join(os.tmpdir(), `jnlr_${Date.now()}.tmp`);
        fs.writeFileSync(tmpFile, ''); 
        
        const editorArgs = [...editorParts.slice(1), tmpFile];

        console.log(`${colors.gray}Handing off to ${editorEnv}...${colors.reset}`);
        spawnSync(editorCmd, editorArgs, { stdio: 'inherit' });

        try {
            const content = fs.readFileSync(tmpFile, 'utf8');
            if (!content.trim()) {
                console.log(`${colors.cyan}ABORTED: Session was empty.${colors.reset}`);
            } else {
                const now = new Date();
                const sessionName = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${now.getTime()}.enc`;
                
                const encryptedPayload = encryptData(Buffer.from(content, 'utf8'), msk);
                fs.writeFileSync(path.join(VAULT_DIR, sessionName), encryptedPayload);
                console.log(`${colors.green}SESSION ENCRYPTED & LOCKED: ${sessionName}${colors.reset}`);
            }
        } finally {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); 
        }
    });

// 3. READ COMMAND
program
    .command('read')
    .alias('r')
    .description('Decrypt and view past sessions')
    .action(async () => {
        if (!fs.existsSync(path.join(VAULT_DIR, 'msk_sudo.enc'))) {
            return console.log(`${colors.red}ERR: VAULT NOT FOUND.${colors.reset}`);
        }

        const pin = await askPin("SUDO PIN: ");
        let msk;
        try {
            const sudoSalt = fs.readFileSync(path.join(VAULT_DIR, 'sudo_salt.bin'));
            const encryptedMsk = fs.readFileSync(path.join(VAULT_DIR, 'msk_sudo.enc'));
            const key = deriveKey(pin, sudoSalt);
            msk = decryptData(encryptedMsk, key);
        } catch (e) {
            return console.log(`${colors.red}ERR: ACCESS DENIED${colors.reset}`);
        }

        const files = getFilesRecursive(VAULT_DIR);

        // Sort all discovered files chronologically descending
        files.sort((a, b) => {
            const timeA = parseInt(path.basename(a).split('-')[3]);
            const timeB = parseInt(path.basename(b).split('-')[3]);
            return timeB - timeA;
        });
        
        if (files.length === 0) return console.log(`${colors.cyan}VAULT IS EMPTY${colors.reset}`);

        console.log(`\n${colors.cyan}AVAILABLE SESSIONS:${colors.reset}`);
        files.forEach((f, i) => {
            const baseName = path.basename(f);
            const dateStr = baseName.split('-').slice(0, 3).join('-');
            const timestamp = parseInt(baseName.split('-')[3]);
            const timeStr = new Date(timestamp).toLocaleTimeString();
            
            // Show the relative folder path if we found it in a subdirectory
            const dir = path.dirname(f);
            const pathPrefix = (dir !== '.') ? `${colors.gray}[${dir}]${colors.reset} ` : '';
            
            console.log(`[${i}] ${pathPrefix}${dateStr} > ${timeStr}`);
        });

        const selection = await askQuestion(`\nENTER SESSION ID [0-${files.length - 1}]: `);
        const fileToRead = files[parseInt(selection)];

        if (!fileToRead) return console.log(`${colors.red}ERR: INVALID SELECTION${colors.reset}`);

        try {
            const payload = fs.readFileSync(path.join(VAULT_DIR, fileToRead));
            const decrypted = decryptData(payload, msk);
            console.log(`\n${colors.gray}--- BEGIN ${path.basename(fileToRead)} ---${colors.reset}\n`);
            console.log(decrypted.toString('utf8'));
            console.log(`\n${colors.gray}--- END OF FILE ---${colors.reset}\n`);
        } catch (e) {
            console.log(`${colors.red}ERR: DECRYPTION FAILED. FILE CORRUPT?${colors.reset}`);
        }
    });

// 4. EXPORT COMMAND
program
    .command('export [outputPath]')
    .alias('e')
    .description('Export vault entries to an ACIT encrypted zip archive')
    .action(async (outputPath) => {
        if (!fs.existsSync(path.join(VAULT_DIR, 'msk_sudo.enc'))) {
            return console.log(`${colors.red}ERR: VAULT NOT FOUND.${colors.reset}`);
        }

        const outPath = outputPath || 'journaller_export.zip';

        const pin = await askPin("SUDO PIN: ");
        let msk;
        try {
            const sudoSalt = fs.readFileSync(path.join(VAULT_DIR, 'sudo_salt.bin'));
            const encryptedMsk = fs.readFileSync(path.join(VAULT_DIR, 'msk_sudo.enc'));
            const key = deriveKey(pin, sudoSalt);
            msk = decryptData(encryptedMsk, key);
        } catch (e) {
            return console.log(`${colors.red}ERR: ACCESS DENIED${colors.reset}`);
        }

        const files = getFilesRecursive(VAULT_DIR);
        if (files.length === 0) return console.log(`${colors.cyan}VAULT IS EMPTY. NOTHING TO EXPORT.${colors.reset}`);

        console.log(`\n${colors.cyan}PREPARING TO EXPORT ${files.length} SESSION(S)...${colors.reset}`);
        const acit = await askPin("SET ACIT (Auth Code in Transit) FOR EXPORT: ");
        const acitConfirm = await askPin("CONFIRM ACIT: ");
        if (acit !== acitConfirm) return console.log(`${colors.red}ERR: ACIT PINS DO NOT MATCH.${colors.reset}`);

        const acitSalt = crypto.randomBytes(16);
        const acitKey = deriveKey(acit, acitSalt);

        const zip = new AdmZip();
        zip.addFile('acit_salt.bin', acitSalt);

        let successCount = 0;
        files.forEach(f => {
            try {
                const payload = fs.readFileSync(path.join(VAULT_DIR, f));
                const rawBuffer = decryptData(payload, msk);
                const acitPayload = encryptData(rawBuffer, acitKey);
                zip.addFile(f, acitPayload);
                successCount++;
            } catch (e) {
                console.log(`${colors.red}ERR: FAILED TO PACK ${f}${colors.reset}`);
            }
        });

        zip.writeZip(outPath);
        console.log(`${colors.green}EXPORT COMPLETE: ${successCount} entries bundled into ${outPath}${colors.reset}`);
    });

// 5. IMPORT COMMAND
program
    .command('import <inputPath>')
    .alias('i')
    .description('Import an ACIT encrypted zip archive into the vault')
    .action(async (inputPath) => {
        if (!fs.existsSync(path.join(VAULT_DIR, 'msk_sudo.enc'))) {
            return console.log(`${colors.red}ERR: TARGET VAULT NOT FOUND. RUN 'jnlr setup' FIRST.${colors.reset}`);
        }

        if (!fs.existsSync(inputPath)) {
            return console.log(`${colors.red}ERR: ZIP FILE NOT FOUND AT ${inputPath}${colors.reset}`);
        }

        const pin = await askPin("SUDO PIN: ");
        let msk;
        try {
            const sudoSalt = fs.readFileSync(path.join(VAULT_DIR, 'sudo_salt.bin'));
            const encryptedMsk = fs.readFileSync(path.join(VAULT_DIR, 'msk_sudo.enc'));
            const key = deriveKey(pin, sudoSalt);
            msk = decryptData(encryptedMsk, key);
        } catch (e) {
            return console.log(`${colors.red}ERR: ACCESS DENIED${colors.reset}`);
        }

        const zip = new AdmZip(inputPath);
        const saltEntry = zip.getEntry('acit_salt.bin');
        
        if (!saltEntry) {
            return console.log(`${colors.red}ERR: INVALID EXPORT ARCHIVE (Missing Salt)${colors.reset}`);
        }

        const acit = await askPin("ENTER ACIT (Auth Code in Transit) TO DECRYPT ZIP: ");
        const acitSalt = saltEntry.getData();
        const acitKey = deriveKey(acit, acitSalt);

        const zipEntries = zip.getEntries();
        let successCount = 0;

        zipEntries.forEach(zipEntry => {
            if (!zipEntry.isDirectory && zipEntry.entryName.endsWith('.enc')) {
                try {
                    const acitPayload = zipEntry.getData();
                    const rawBuffer = decryptData(acitPayload, acitKey);
                    const finalPayload = encryptData(rawBuffer, msk);
                    
                    const targetPath = path.join(VAULT_DIR, zipEntry.entryName);
                    const targetDir = path.dirname(targetPath);
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    
                    fs.writeFileSync(targetPath, finalPayload);
                    successCount++;
                } catch (e) {
                    console.log(`${colors.red}ERR: FAILED TO EXTRACT ${zipEntry.entryName}. INCORRECT ACIT?${colors.reset}`);
                }
            }
        });

        console.log(`${colors.green}IMPORT COMPLETE: ${successCount} entries added to vault.${colors.reset}`);
    });

program.parse(process.argv);
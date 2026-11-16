#!/usr/bin/env node

/**
 * Universal cross-platform installer for the LinkResurrector native host.
 * Works on macOS, Windows, and Linux using pure Node.js (no Python or shell dependencies).
 *
 * Usage:
 *   node server/install.mjs <32-character Chrome extension ID>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const extId = (process.argv[2] || process.env.LINKRESURRECTOR_EXTENSION_ID || '').trim();

if (!/^[a-p]{32}$/.test(extId)) {
  console.error('\x1b[31m[Error] Invalid Chrome extension ID.\x1b[0m');
  console.error('Usage: node server/install.mjs <32-character Chrome extension ID>');
  console.error('Example: node server/install.mjs abcdefghijklmnopabcdefghijklmnop\n');
  console.error('Find your ID at chrome://extensions with Developer Mode enabled.');
  process.exit(1);
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  console.error(`\x1b[31m[Error] Node.js 18 or newer is required (found v${process.versions.node}).\x1b[0m`);
  process.exit(1);
}

const home = os.homedir();
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// 1. Determine native install folder
let installRoot;
if (isWin) {
  installRoot = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'LinkResurrector', 'native');
} else if (isMac) {
  installRoot = path.join(home, 'Library', 'Application Support', 'LinkResurrector', 'native');
} else {
  installRoot = path.join(home, '.local', 'share', 'linkresurrector', 'native');
}

// 2. Clean and create install directory
try {
  if (fs.existsSync(installRoot)) {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(installRoot, { recursive: true });
} catch (err) {
  console.error(`\x1b[31m[Error] Failed to create directory: ${installRoot}\x1b[0m`, err);
  process.exit(1);
}

// 3. Copy src/, native-host.js, and template files
const sourceSrc = path.join(moduleDir, 'src');
const destSrc = path.join(installRoot, 'src');
if (fs.existsSync(sourceSrc)) {
  fs.cpSync(sourceSrc, destSrc, { recursive: true });
}

fs.copyFileSync(path.join(moduleDir, 'native-host.js'), path.join(installRoot, 'native-host.js'));

const envExample = path.join(moduleDir, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(path.dirname(installRoot), '.env.example'));
}

fs.writeFileSync(path.join(installRoot, 'package.json'), '{"type":"module"}\n');

// 4. Create launcher wrapper (Chromium M124+ requires executable launcher path; ignores args array)
const scriptPath = path.join(installRoot, 'native-host.js');
let launcherPath;

if (isWin) {
  launcherPath = path.join(installRoot, 'linkresurrector-host.bat');
  const batContent = `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`;
  fs.writeFileSync(launcherPath, batContent, 'ascii');
} else {
  launcherPath = path.join(installRoot, 'linkresurrector-host.sh');
  const shContent = `#!/usr/bin/env bash\nexec "${process.execPath}" "${scriptPath}" "$@"\n`;
  fs.writeFileSync(launcherPath, shContent, { encoding: 'utf8', mode: 0o755 });
}

// 5. Build Native Messaging Manifest
const manifest = {
  name: 'com.linkresurrector.native',
  description: 'LinkResurrector on-device URL recovery helper',
  path: launcherPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extId}/`],
};

const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
const localManifestPath = path.join(installRoot, 'com.linkresurrector.native.json');
fs.writeFileSync(localManifestPath, manifestJson);

// 6. Register Manifest with Browsers
if (isWin) {
  const registryTargets = [
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.linkresurrector.native',
    'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.linkresurrector.native',
    'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.linkresurrector.native',
  ];

  for (const regKey of registryTargets) {
    try {
      execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${localManifestPath}" /f`, { stdio: 'ignore' });
    } catch {
      // Ignored if browser not installed
    }
  }
} else {
  const browserDirs = isMac
    ? [
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
      ]
    : [
        path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
        path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, '.config', 'chromium', 'NativeMessagingHosts'),
        path.join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts'),
      ];

  for (const dir of browserDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'com.linkresurrector.native.json'), manifestJson);
    } catch {
      // Ignore directories that can't be created
    }
  }
}

console.log('\x1b[32m[✓] LinkResurrector native helper installed successfully!\x1b[0m');
console.log(`    Extension ID: ${extId}`);
console.log(`    Native Host:  ${launcherPath}`);
console.log('\n\x1b[33m[!] IMPORTANT: Completely quit and restart Chrome / Brave (Cmd+Q or Alt+F4) for changes to take effect.\x1b[0m\n');

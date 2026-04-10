#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_SHARED_CHECK_SCRIPT = process.env.MAGICMIRROR_SHARED_CHECK_SCRIPT || '/opt/mm-tools/magicmirror-check.mjs';
const REQUIREMENT_FLAG = '--devcontainer-only';

function main() {
  const wrapperArgs = process.argv.slice(2);
  const userArgs = wrapperArgs.filter((arg) => arg !== REQUIREMENT_FLAG);
  const sharedScript = path.resolve(DEFAULT_SHARED_CHECK_SCRIPT);

  if (!existsSync(sharedScript)) {
    console.error('⚠️  MagicMirror checker is not available in this environment.');
    console.error('   This wrapper expects the shared checker script from the MMM devcontainer base image.');
    console.error(`   Expected path: ${sharedScript}`);
    console.error('   Rebuild or reopen the module inside the custom devcontainer to use this command.');
    process.exit(1);
  }

  const child = spawn(process.execPath, [sharedScript, ...userArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      MAGICMIRROR_CURRENT_MODULE_DIR: process.cwd(),
    },
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to start shared MagicMirror checker: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main();

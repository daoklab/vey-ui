/*
 * SPDX-License-Identifier: Apache-2.0
 * Shared helpers for the VEY console bridge: subprocess wrappers, YAML
 * read/write, atomic file writes and availability probes.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import YAML from 'yaml';

export const execFileAsync = promisify(execFile);

export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, content, { mode });
  await rename(temp, path);
}

/**
 * Create a vey-ctl runner bound to a control socket.
 * `pid` may be '0' (auto) or a concrete daemon pid.
 */
export function makeCtlRunner({
  binary,
  controlDir,
  group = '',
  pid = '0',
  timeout = 8000,
  maxBuffer = 128 * 1024,
}) {
  const base = (args) => [
    '--control-dir',
    controlDir,
    '--daemon-group',
    group ?? '',
    '--daemon-pid',
    String(pid ?? '0'),
    ...args,
  ];
  return async function runCtl(args) {
    const { stdout } = await execFileAsync(binary, base(args), {
      timeout,
      maxBuffer,
    });
    return stdout.trim();
  };
}

/**
 * Build command-line args for a vey daemon binary (same shape as the ctl
 * tools accept) so validation and lifecycle probes use one code path.
 */
export function daemonArgs({
  configFile,
  controlDir,
  pidFile,
  daemon = false,
}) {
  const args = [];
  if (configFile) args.push('--config-file', configFile);
  if (controlDir) args.push('--control-dir', controlDir);
  if (pidFile) args.push('--pid-file', pidFile);
  if (daemon) args.push('--daemon');
  return args;
}

export async function readConfigText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function parseYaml(text) {
  return YAML.parse(text);
}

export function stringifyYaml(doc) {
  return YAML.stringify(doc);
}

export function isEmptyValue(value) {
  return value === undefined || value === null;
}

export function parseLineList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function safeError(error) {
  if (!(error instanceof Error)) return String(error);
  if (error.stderr) return error.stderr.trim() || error.message;
  return error.message;
}

export function noop() {}

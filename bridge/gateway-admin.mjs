/*
 * SPDX-License-Identifier: Apache-2.0
 * Full management endpoints for the vey-gateway daemon: process lifecycle,
 * structured server/discover/backend configuration CRUD and snapshots.
 *
 * The daemon is controlled through vey-gateway-ctl over its local Cap'n
 * Proto socket. Config mutations are staged through a temporary file,
 * validated with `vey-gateway --test-config`, atomically committed and then
 * applied with a targeted resource reload (directory-backed resources) or a
 * full daemon reload (inline resources).
 */
import { readdir, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';

import {
  atomicWrite,
  daemonArgs,
  execFileAsync,
  fileExists,
  parseYaml,
  safeError,
  stringifyYaml,
} from './lib.mjs';

const RESOURCE_KINDS = ['server', 'discover', 'backend'];
const RELOAD_COMMAND = {
  server: 'reload-server',
  discover: 'reload-discover',
  backend: 'reload-backend',
};
const NAME_RE = /^[\w.-]{1,128}$/;

const LIFECYCLE = {
  version: {
    needsName: false,
    build: () => ['version'],
    message: '读取网关版本',
  },
  offline: {
    needsName: false,
    build: () => ['offline'],
    message: '网关已进入离线模式',
  },
  reload: {
    needsName: false,
    build: () => ['reload'],
    message: '网关已重新加载配置',
  },
  'cancel-shutdown': {
    needsName: false,
    build: () => ['cancel-shutdown'],
    message: '已取消网关关闭流程',
  },
  'force-quit': {
    needsName: true,
    build: (name) => ['force-quit', name],
    message: (name) => `已强制退出服务器 ${name}`,
  },
  'force-quit-all': {
    needsName: false,
    build: () => ['force-quit-all'],
    message: '已强制退出全部离线服务器',
  },
};

function resourceSection(doc) {
  return RESOURCE_KINDS.filter((kind) =>
    Object.prototype.hasOwnProperty.call(doc ?? {}, kind),
  );
}

/**
 * Accept a resource spec either as an object (`body.spec`) or as raw YAML
 * text (`body.specYaml`). Parsing in the bridge reuses the same YAML engine
 * used everywhere else and keeps the browser bundle free of a YAML parser.
 */
function specFromBody(body) {
  if (body.specYaml !== undefined) {
    const text = String(body.specYaml);
    if (!text || text.length > 256 * 1024)
      return { error: '资源 YAML 内容无效或过大' };
    let parsed;
    try {
      parsed = parseYaml(text);
    } catch (error) {
      return { error: `资源 YAML 解析失败：${safeError(error)}` };
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { error: '资源 YAML 内容必须是映射对象' };
    }
    return { spec: parsed };
  }
  if (
    typeof body.spec !== 'object' ||
    body.spec === null ||
    Array.isArray(body.spec)
  ) {
    return { error: '资源内容必须是 YAML 映射对象' };
  }
  return { spec: body.spec };
}

/**
 * Resolve where a section's resources live: inline arrays in the main YAML,
 * or a directory of per-resource YAML files referenced by a scalar path.
 */
function sectionLayout(doc, kind, configDir) {
  const value = doc?.[kind];
  if (Array.isArray(value)) {
    return {
      form: 'inline',
      entries: value.filter((entry) => entry && typeof entry === 'object'),
    };
  }
  if (typeof value === 'string') {
    const root = resolve(configDir, value);
    return { form: 'directory', root };
  }
  if (value === undefined || value === null) {
    return { form: 'inline', entries: [] };
  }
  return { form: 'unknown', raw: value };
}

async function listDirectoryEntries(root) {
  try {
    const files = await readdir(root);
    return files
      .filter((file) => /\.(yaml|yml)$/i.test(file))
      .map((file) => basename(file, extname(file)))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readDirectoryEntry(root, name) {
  for (const ext of ['.yaml', '.yml']) {
    const path = resolve(root, `${name}${ext}`);
    if (await fileExists(path)) {
      const text = await readFile(path, 'utf8');
      return { name, path, spec: parseYaml(text) ?? {} };
    }
  }
  return null;
}

async function writeDirectoryEntry(root, name, spec) {
  const path = resolve(root, `${name}.yaml`);
  await atomicWrite(path, stringifyYaml(spec));
  return path;
}

export function createGatewayAdmin({
  json,
  readBody,
  runCtl,
  configFile,
  controlDir,
  gatewayBin,
}) {
  const configDir = dirname(configFile);
  const validateWithGateway = async (content) => {
    const candidate = `${configFile}.console-check.yaml`;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(candidate, content, { mode: 0o600 });
    try {
      await execFileAsync(
        gatewayBin,
        [
          '--test-config',
          '--control-dir',
          controlDir,
          '--config-file',
          candidate,
        ],
        { timeout: 15_000, maxBuffer: 256 * 1024 },
      );
    } finally {
      await unlink(candidate).catch(() => {});
    }
  };

  async function readMainDoc() {
    const text = await readFile(configFile, 'utf8');
    let doc;
    try {
      doc = parseYaml(text) ?? {};
    } catch (error) {
      throw new Error(`网关配置不是合法 YAML：${safeError(error)}`, {
        cause: error,
      });
    }
    if (typeof doc !== 'object' || Array.isArray(doc))
      throw new Error('网关配置根节点应为 YAML 映射');
    return { doc, text };
  }

  async function applyResourceChange({ beforeText, afterText, kind, name }) {
    // Validate first, then persist, then apply with a reload that matches
    // the resource layout (targeted where possible).
    await validateWithGateway(afterText);
    await atomicWrite(configFile, afterText);
    try {
      await runCtl([RELOAD_COMMAND[kind], name]);
    } catch {
      // Inline resources cannot be reloaded individually; fall back to the
      // whole daemon reload which may fail if other parts of the config are
      // currently inconsistent. Report the failure without corrupting the file.
      try {
        await runCtl(['reload']);
      } catch (reloadError) {
        throw new Error(`配置已保存，但应用失败：${safeError(reloadError)}`, {
          cause: reloadError,
        });
      }
    }
  }

  async function rebuildWithResource(
    doc,
    kind,
    entry,
    { remove = false } = {},
  ) {
    const name = String(entry.name ?? '');
    if (!NAME_RE.test(name))
      throw new Error('资源名称只能包含字母、数字、点、下划线和短横线');
    const layout = sectionLayout(doc, kind, configDir);
    if (layout.form === 'directory') {
      if (remove) {
        const target = await readDirectoryEntry(layout.root, name);
        if (!target) throw new Error(`资源 ${name} 不存在`);
        await unlink(target.path).catch(() => {});
        const afterText = await readFile(configFile, 'utf8');
        await validateWithGateway(afterText);
        try {
          await runCtl([RELOAD_COMMAND[kind], name]);
        } catch {
          try {
            await runCtl(['reload']);
          } catch (reloadError) {
            throw new Error(
              `配置已保存，但应用失败：${safeError(reloadError)}`,
              { cause: reloadError },
            );
          }
        }
        return { message: `${kind} ${name} 已删除并应用` };
      }
      await writeDirectoryEntry(layout.root, name, entry.spec ?? {});
      const afterText = await readFile(configFile, 'utf8');
      await validateWithGateway(afterText);
      try {
        await runCtl([RELOAD_COMMAND[kind], name]);
      } catch {
        try {
          await runCtl(['reload']);
        } catch (reloadError) {
          throw new Error(`配置已保存，但应用失败：${safeError(reloadError)}`, {
            cause: reloadError,
          });
        }
      }
      return { message: `${kind} ${name} 已写入并热加载` };
    }
    // Inline layout: mutate the array in the YAML document.
    const list = Array.isArray(doc[kind]) ? [...doc[kind]] : [];
    const index = list.findIndex((item) => item?.name === name);
    if (remove) {
      if (index === -1) throw new Error(`资源 ${name} 不存在`);
      list.splice(index, 1);
    } else if (index === -1) {
      list.push(entry.spec ?? {});
    } else {
      list[index] = entry.spec ?? {};
    }
    doc[kind] = list;
    await applyResourceChange({
      beforeText: '',
      afterText: stringifyYaml(doc),
      kind,
      name,
    });
    return {
      message: remove
        ? `${kind} ${name} 已删除并重载`
        : `${kind} ${name} 已保存并重载`,
    };
  }

  return async function handleGatewayAdmin(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/gateway/lifecycle') {
      return json(res, 200, {
        ok: true,
        actions: Object.entries(LIFECYCLE).map(([action, spec]) => ({
          action,
          needsName: spec.needsName,
          message:
            typeof spec.message === 'function'
              ? spec.message('<name>')
              : spec.message,
        })),
      });
    }
    if (req.method === 'POST' && url.pathname === '/gateway/lifecycle') {
      const body = await readBody(req);
      const action = String(body.action ?? '');
      const spec = LIFECYCLE[action];
      if (!spec) {
        return json(res, 400, {
          error: `不支持的生命周期操作 ${action}，可用：${Object.keys(LIFECYCLE).join(', ')}`,
        });
      }
      const name = body.name === undefined ? '' : String(body.name);
      if (spec.needsName && !NAME_RE.test(name)) {
        return json(res, 400, { error: `${action} 需要有效的资源名称` });
      }
      try {
        const args = spec.build(name || undefined);
        const output = await runCtl(args);
        const message =
          typeof spec.message === 'function'
            ? spec.message(name)
            : spec.message;
        return json(res, 200, {
          ok: true,
          action,
          name: name || undefined,
          message,
          output,
        });
      } catch (error) {
        return json(res, 503, {
          error: `${messageLabel(spec, name)}失败：${safeError(error)}`,
        });
      }
    }

    // --- Structured resource CRUD (server / discover / backend) ---
    if (req.method === 'GET' && url.pathname === '/gateway/resources') {
      const { doc } = await readMainDoc();
      const sections = {};
      for (const kind of RESOURCE_KINDS) {
        const layout = sectionLayout(doc, kind, configDir);
        if (layout.form === 'directory') {
          sections[kind] = {
            form: 'directory',
            entries: await listDirectoryEntries(layout.root),
          };
        } else if (layout.form === 'inline') {
          sections[kind] = { form: 'inline', entries: layout.entries };
        } else {
          sections[kind] = { form: 'unknown' };
        }
      }
      return json(res, 200, { ok: true, sections });
    }

    const collectionMatch =
      /^\/gateway\/resources\/(server|discover|backend)$/.exec(url.pathname);
    const itemMatch =
      /^\/gateway\/resources\/(server|discover|backend)\/([\w.-]+)$/.exec(
        url.pathname,
      );
    const kindOf = (match) => match?.[1];

    if (req.method === 'GET' && collectionMatch) {
      const kind = kindOf(collectionMatch);
      const { doc } = await readMainDoc();
      const layout = sectionLayout(doc, kind, configDir);
      if (layout.form === 'directory') {
        const names = await listDirectoryEntries(layout.root);
        const resources = await Promise.all(
          names.map(
            async (name) =>
              (await readDirectoryEntry(layout.root, name)) ?? { name },
          ),
        );
        return json(res, 200, { ok: true, kind, form: 'directory', resources });
      }
      if (layout.form === 'inline') {
        return json(res, 200, {
          ok: true,
          kind,
          form: 'inline',
          resources: layout.entries,
        });
      }
      return json(res, 422, { error: `${kind} 配置段格式无法识别` });
    }

    if (req.method === 'GET' && itemMatch) {
      const kind = kindOf(itemMatch);
      const name = itemMatch[2];
      const { doc } = await readMainDoc();
      const layout = sectionLayout(doc, kind, configDir);
      let entry = null;
      if (layout.form === 'directory')
        entry = await readDirectoryEntry(layout.root, name);
      else if (layout.form === 'inline')
        entry = layout.entries.find((item) => item?.name === name) ?? null;
      else return json(res, 422, { error: `${kind} 配置段格式无法识别` });
      if (!entry) return json(res, 404, { error: `${kind} ${name} 不存在` });
      const spec = layout.form === 'directory' ? (entry.spec ?? {}) : entry;
      return json(res, 200, {
        ok: true,
        kind,
        name,
        form: layout.form,
        spec,
        specYaml: stringifyYaml(spec),
      });
    }

    if (req.method === 'POST' && collectionMatch) {
      const kind = kindOf(collectionMatch);
      const body = await readBody(req, 256 * 1024);
      const name = String(body.name ?? '');
      if (!NAME_RE.test(name))
        return json(res, 400, {
          error: '资源名称只能包含字母、数字、点、下划线和短横线',
        });
      const parsed = specFromBody(body);
      if (parsed.error) return json(res, 400, { error: parsed.error });
      const spec = { ...parsed.spec, name };
      const { doc } = await readMainDoc();
      const layout = sectionLayout(doc, kind, configDir);
      const exists =
        layout.form === 'directory'
          ? Boolean(await readDirectoryEntry(layout.root, name))
          : layout.form === 'inline'
            ? layout.entries.some((item) => item?.name === name)
            : null;
      if (exists === null)
        return json(res, 422, { error: `${kind} 配置段格式无法识别` });
      if (exists) return json(res, 409, { error: `${kind} ${name} 已存在` });
      const result = await rebuildWithResource(doc, kind, { name, spec });
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'PUT' && itemMatch) {
      const kind = kindOf(itemMatch);
      const name = itemMatch[2];
      const body = await readBody(req, 256 * 1024);
      const parsed = specFromBody(body);
      if (parsed.error) return json(res, 400, { error: parsed.error });
      const spec = { ...parsed.spec, name };
      const { doc } = await readMainDoc();
      const layout = sectionLayout(doc, kind, configDir);
      const exists =
        layout.form === 'directory'
          ? Boolean(await readDirectoryEntry(layout.root, name))
          : layout.form === 'inline'
            ? layout.entries.some((item) => item?.name === name)
            : null;
      if (exists === null)
        return json(res, 422, { error: `${kind} 配置段格式无法识别` });
      if (!exists) return json(res, 404, { error: `${kind} ${name} 不存在` });
      const result = await rebuildWithResource(doc, kind, { name, spec });
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'DELETE' && itemMatch) {
      const kind = kindOf(itemMatch);
      const name = itemMatch[2];
      const { doc } = await readMainDoc();
      const result = await rebuildWithResource(
        doc,
        kind,
        { name },
        { remove: true },
      );
      return json(res, 200, { ok: true, ...result });
    }

    return false;
  };
}

function messageLabel(spec, name) {
  if (typeof spec.message === 'function') return spec.message(name);
  return spec.message;
}

export {
  daemonArgs,
  listDirectoryEntries,
  readDirectoryEntry,
  RELOAD_COMMAND,
  RESOURCE_KINDS,
  sectionLayout,
  writeDirectoryEntry,
};

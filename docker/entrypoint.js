#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Docker entrypoint — starts @xiboplayer/proxy serving the built PWA.
 *
 * Copied into the image at /app/proxy/bin/docker-entrypoint.js, so the
 * relative import below resolves against the deployed proxy package.
 *
 * Configuration (later sources win):
 *   1. config.json at $CONFIG_FILE (default /config/config.json) — same format
 *      as the Electron/Chromium shells: shell keys (serverPort, relaxSslCerts,
 *      allowShellCommands, ...) plus any PWA keys (cmsUrl, cmsKey, ...).
 *   2. Environment variables (see .env.example).
 *
 * The proxy writes back to config.json when the setup screen POSTs /config,
 * so mount /config as a writable volume to keep settings across restarts.
 */

import fs from 'fs';
import path from 'path';
import { startServer } from '../src/index.js';
import { extractPwaConfig, computeCmsId } from '@xiboplayer/utils';

const env = process.env;
const CONFIG_FILE = env.CONFIG_FILE || '/config/config.json';

function readConfigFile(file) {
  if (!fs.existsSync(file)) {
    console.log(`[docker] No config file at ${file} — starting with env/defaults only`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[docker] Failed to parse ${file}: ${err.message}`);
    process.exit(1);
  }
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

const fileConfig = readConfigFile(CONFIG_FILE);

// Env overrides for PWA keys (only applied when set and non-empty)
const ENV_PWA_KEYS = {
  CMS_URL: 'cmsUrl',
  CMS_KEY: 'cmsKey',
  PLAYER_API_BASE: 'playerApiBase',
  API_CLIENT_ID: 'apiClientId',
  API_CLIENT_SECRET: 'apiClientSecret',
  LOG_LEVEL: 'logLevel',
};
const envOverrides = {};
for (const [envKey, configKey] of Object.entries(ENV_PWA_KEYS)) {
  if (env[envKey]) envOverrides[configKey] = env[envKey];
}
if (envOverrides.cmsUrl) envOverrides.cmsUrl = envOverrides.cmsUrl.replace(/\/$/, '');

// Arbitrary extra PWA keys as JSON, e.g. PWA_CONFIG_JSON='{"transport":"xmds"}'
let extraJson = {};
if (env.PWA_CONFIG_JSON) {
  try {
    extraJson = JSON.parse(env.PWA_CONFIG_JSON);
  } catch (err) {
    console.error(`[docker] PWA_CONFIG_JSON is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

const config = { ...fileConfig, ...extraJson, ...envOverrides };

// The injected localStorage seed is keyed by cmsId — derive it when missing
// or when the CMS URL was overridden from env.
if (config.cmsUrl && (!config.cmsId || envOverrides.cmsUrl)) {
  config.cmsId = computeCmsId(config.cmsUrl);
}

// Container-only keys never reach the PWA. Per-display identity keys are
// also dropped: this server is shared by many displays, and injecting them
// would give every display the same hardware key / name.
const DOCKER_ONLY_KEYS = ['listenAddress', 'dataDir'];
const PER_DISPLAY_KEYS = ['hardwareKey', 'displayName', 'xmrPubKey', 'xmrPrivKey'];
for (const key of PER_DISPLAY_KEYS) {
  if (config[key] !== undefined) {
    console.warn(`[docker] Ignoring per-display key "${key}" — this server is shared by all displays`);
  }
}
const pwaConfig = extractPwaConfig(config, [...DOCKER_ONLY_KEYS, ...PER_DISPLAY_KEYS]);

const port = parseInt(env.PORT || config.serverPort || '8765', 10);
const listenAddress = env.LISTEN_ADDRESS || config.listenAddress || '0.0.0.0';
const dataDir = env.DATA_DIR || config.dataDir || '/data';
const pwaPath = env.PWA_PATH || '/app/pwa';

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });

startServer({
  port,
  listenAddress,
  pwaPath,
  appVersion: env.APP_VERSION || '0.0.0',
  pwaConfig,
  configFilePath: CONFIG_FILE,
  dataDir,
  relaxSslCerts: bool(env.RELAX_SSL_CERTS, config.relaxSslCerts ?? false),
  allowShellCommands: bool(env.ALLOW_SHELL_COMMANDS, config.allowShellCommands ?? false),
}).then(() => {
  console.log(`[docker] Player available over plain HTTP at http://${listenAddress}:${port}/player/`);
  if (!pwaConfig?.cmsUrl) {
    console.log('[docker] No cmsUrl configured — the player will show the setup screen');
  }
}).catch((err) => {
  console.error('[docker] Failed to start:', err.message);
  process.exit(1);
});

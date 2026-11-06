'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { trustedRequest } = require('../middleware/request-security');
const promptStore = require('../domain/catalog/prompt-store');
const { readRemoved, updateRemoved } = require('../repositories/library-removal-store');
const editHistory = require('../repositories/edit-history-store');
const { readVersion, webRevision } = require('../../../packages/runtime/version');
const { createConfiguration } = require('../configuration');

function createRuntimeDependencies(root, env = process.env) {
  const configuration = createConfiguration(root, env);
  const jsonConfigStore = require('../repositories/json-config-store').createStore();
  const manualStore = require('../repositories/manual-store').createStore(root);
  const qualityService = require('../infrastructure/quality-service').createQualityService(root);
  const assetCatalog = require('../repositories/asset-catalog').createCatalog(root);
  const regionStore = require('../repositories/region-store').createRegionStore(root);
  const workQueue = require('../repositories/work-queue-store').createQueueStore(root);
  const exportPresets = require('../repositories/export-presets').createExportPresets(root);
  const backupStore = require('../infrastructure/backup-store').createBackupStore(root, {
    config: configuration.CONFIG_FILE,
    prompts: promptStore.FILE,
  });
  const acceptanceStore = require('../repositories/acceptance-store').createAcceptanceStore(root);
  const backgroundRenderer = require('../infrastructure/background-renderer').createRenderer(
    root,
    configuration.BACKGROUND_RENDERER_URL,
  );

  return {
    http, fs, path, crypto, spawn, trustedRequest,
    PROMPTS_FILE: promptStore.FILE,
    readCatalog: promptStore.readCatalog,
    updateCatalog: promptStore.updateCatalog,
    renderTemplate: promptStore.renderTemplate,
    savePresetPrompt: promptStore.savePresetPrompt,
    listModes: promptStore.listModes,
    saveMode: promptStore.saveMode,
    migrateBrowser: promptStore.migrateBrowser,
    previewImport: promptStore.previewImport,
    importCatalog: promptStore.importCatalog,
    readRemoved, updateRemoved, editHistory, jsonConfigStore, manualStore, qualityService,
    assetCatalog, regionStore, workQueue, exportPresets, backupStore, acceptanceStore,
    backgroundRenderer, readVersion, webRevision,
    ...configuration,
  };
}

module.exports = { createRuntimeDependencies };

'use strict';

const { getDb } = require('../../db/database');
const secretVault = require('../security/secretVault');

const OPENAI_COMPAT_TYPES = new Set(['openai', 'openrouter', 'deepseek', 'mistral', 'xai', 'groq', 'custom']);

function parseModels(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.filter(Boolean).map((m) => String(m).trim()).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

function isSeedKey(key) {
    return secretVault.isSeedSecret(key);
}

function decryptProviderKey(row) {
    return secretVault.decryptProviderKey(row);
}

function normalizeProvider(row) {
    const apiKey = decryptProviderKey(row);
    const models = parseModels(row.supported_models_json);
    const validKey = apiKey && !isSeedKey(apiKey);
    return {
        id: row.id,
        name: row.name,
        type: row.provider_type,
        endpoint: row.api_endpoint,
        status: row.status,
        priority: Number(row.priority || 999),
        fallbackProviderId: row.fallback_provider_id || null,
        defaultCodingModel: row.default_model_coding || null,
        defaultChatModel: row.default_model_chat || null,
        defaultResearchModel: row.default_model_research || null,
        models,
        keyPrefix: row.key_prefix || null,
        apiKey: validKey ? apiKey : null,
        hasRealKey: Boolean(validKey),
        available: row.status === 'active' && Boolean(validKey),
    };
}

function getProviderRows() {
    const db = getDb();
    return db.prepare(`
    SELECT id, name, provider_type, api_endpoint, key_ciphertext, key_iv, key_tag, key_prefix,
           status, priority, fallback_provider_id, supported_models_json,
           default_model_coding, default_model_chat, default_model_research
    FROM ai_providers
    ORDER BY priority ASC, updated_at DESC
  `).all();
}

function listConfiguredProviders() {
    return getProviderRows().map(normalizeProvider);
}

function listUsableProviders() {
    return listConfiguredProviders().filter((p) => p.status === 'active' && p.hasRealKey);
}

function getPrimaryProvider() {
    return listUsableProviders()[0] || null;
}

function findProviderByModel(modelId) {
    const id = String(modelId || '').trim();
    if (!id) return null;
    return listUsableProviders().find((p) => p.models.includes(id)) || null;
}

function getRoutingDefaults() {
    const usable = listUsableProviders();
    const primary = usable[0] || null;
    const fallback = usable.find((p) => p.id === primary?.fallbackProviderId) || usable[1] || null;
    return {
        providers: usable,
        primary,
        fallback,
        defaultCodingModel: primary?.defaultCodingModel || primary?.models[0] || null,
        defaultChatModel: primary?.defaultChatModel || primary?.models[0] || null,
        defaultResearchModel: primary?.defaultResearchModel || primary?.models[0] || null,
    };
}

function isOpenAiCompatibleProvider(type) {
    return OPENAI_COMPAT_TYPES.has(String(type || '').trim().toLowerCase());
}

module.exports = {
    isSeedKey,
    isOpenAiCompatibleProvider,
    listConfiguredProviders,
    listUsableProviders,
    getPrimaryProvider,
    findProviderByModel,
    getRoutingDefaults,
};

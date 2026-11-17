process.env.NODE_ENV = 'test';

const assert = require('node:assert');
const providerRegistry = require('../services/ai/providerRegistry');
const secretVault = require('../services/security/secretVault');
const { getDb } = require('../db/database');
const workspaceModelRouter = require('../services/ai/workspaceModelRouter');

workspaceModelRouter.registerCloudAdapter('openai', { models: () => [] });

async function main() {
    const db = getDb();
    const openAiKey = 'sk-live-openai-real-key-1234567890abcdef';

    db.prepare(`
    UPDATE ai_providers
    SET key_ciphertext = NULL,
        key_iv = NULL,
        key_tag = NULL,
        key_prefix = 'sk-seed-...mock',
        status = 'active'
    WHERE provider_type IN ('gemini', 'openai')
  `).run();

    const enc = secretVault.encryptSecret(openAiKey);
    db.prepare(`
    UPDATE ai_providers
    SET key_ciphertext = ?,
        key_iv = ?,
        key_tag = ?,
        key_prefix = ?,
        status = 'active',
        priority = 1,
        default_model_chat = 'gpt-4o-mini',
        default_model_coding = 'gpt-4o'
    WHERE provider_type = 'openai'
  `).run(enc.ciphertext, enc.iv, enc.tag, enc.prefix);

    db.prepare(`
    UPDATE ai_providers
    SET key_prefix = 'sk-seed-...mock',
        priority = 2,
        default_model_chat = 'gemini-2.0-flash'
    WHERE provider_type = 'gemini'
  `).run();

    workspaceModelRouter._resetCache();

    const providers = providerRegistry.listUsableProviders();
    assert.ok(providers.some((p) => p.type === 'openai'), 'OpenAI provider must be usable');
    assert.ok(!providers.some((p) => p.type === 'gemini'), 'Gemini mock provider must be excluded');

    const models = await workspaceModelRouter.listModels({ force: true });
    assert.strictEqual(models.defaultModelId, 'gpt-4o-mini');
    assert.ok(models.models.some((m) => m.id === 'gpt-4o' && m.available), 'OpenAI coding model should be listed');
    assert.ok(models.models.some((m) => m.id === 'gpt-4o-mini' && m.available), 'OpenAI chat model should be listed');
    assert.ok(!models.models.some((m) => m.id === 'gemini-2.0-flash' && m.available), 'Gemini model should not be listed when key is mock');

    const resolved = await workspaceModelRouter.resolveModel('gemini-2.0-flash');
    assert.strictEqual(resolved.id, 'gpt-4o-mini');
    assert.strictEqual(resolved.provider, 'openai');

    console.log('PASS workspaceProviderRouting.integration.test');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

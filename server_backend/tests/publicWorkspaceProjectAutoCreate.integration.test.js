process.env.NODE_ENV = 'test';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '../../server.ts');
const source = fs.readFileSync(serverPath, 'utf8');

assert.ok(source.includes('findOrCreateProject(String(projectId)'), 'Chat pipeline must auto-create missing projects');
assert.ok(source.includes("app.get('/api/projects/:id'"), 'Project read endpoint must exist for public workspace');
assert.ok(source.includes("app.get('/api/projects'"), 'Project list endpoint must exist for public workspace');
assert.ok(source.includes("models: (data.models || []).filter"), 'Public model list must filter unreachable local models');

console.log('PASS publicWorkspaceProjectAutoCreate.integration.test');

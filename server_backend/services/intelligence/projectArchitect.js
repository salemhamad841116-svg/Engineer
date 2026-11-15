/**
 * projectArchitect.js
 * Capability 02: Autonomous Project Architect (Coding Intelligence)
 *
 * Analyzes client specifications to synthesize a formal Architecture Manifest
 * defining folder structures, API contracts, database schemas, component trees,
 * and security policies before code emission begins.
 */

function designArchitectureManifest(prompt = '', options = {}) {
  const p = String(prompt || '').toLowerCase();
  const projectName = options.projectName || (prompt.slice(0, 30).trim() || 'Autonomous Application');
  const stack = options.stack || 'react_vite';

  // 1. Identify Domain Category
  let category = 'general_web';
  if (/تداول|مالي|أسهم|عملات|trading|quant|financial/i.test(p)) {
    category = 'trading_fintech';
  } else if (/متجر|مبيعات|سلة|pos|ecommerce|store|cart/i.test(p)) {
    category = 'ecommerce_retail';
  } else if (/حجز|مواعيد|عيادة|طبيب|booking|appointment|clinic/i.test(p)) {
    category = 'healthcare_scheduler';
  } else if (/مزاد|مزايدة|auction|bidding/i.test(p)) {
    category = 'auction_marketplace';
  } else if (/زكاة|ذهب|فضة|zakat|gold/i.test(p)) {
    category = 'islamic_wealth_calculator';
  }

  // 2. Define Folder Structure based on stack
  const folderStructure = [
    { path: 'src/', type: 'directory', description: 'Application source code' },
    { path: 'src/components/', type: 'directory', description: 'Reusable UI components' },
    { path: 'src/services/', type: 'directory', description: 'Business logic and API clients' },
    { path: 'src/types/', type: 'directory', description: 'Data models & TypeScript interfaces' },
    { path: 'migrations/', type: 'directory', description: 'Database schema migrations' },
    { path: 'tests/', type: 'directory', description: 'Unit and acceptance test suites' },
    { path: 'public/', type: 'directory', description: 'Static assets' },
    { path: 'README.md', type: 'file', description: 'Project documentation & architectural guide' },
    { path: '.env.example', type: 'file', description: 'Sample environment variables' }
  ];

  // 3. Define API Contracts
  const apiContracts = [
    {
      method: 'GET',
      path: '/api/v1/health',
      description: 'Liveness probe and system status check',
      requestSchema: {},
      responseSchema: { status: 'string', timestamp: 'string' },
      statusCode: 200
    },
    {
      method: 'GET',
      path: '/api/v1/items',
      description: 'Fetch item collection with pagination and filtering',
      requestSchema: { query: 'string?', limit: 'number?', offset: 'number?' },
      responseSchema: { items: 'array', total: 'number' },
      statusCode: 200
    },
    {
      method: 'POST',
      path: '/api/v1/items',
      description: 'Create a new record with validation',
      requestSchema: { title: 'string', amount: 'number?', payload: 'object?' },
      responseSchema: { id: 'string', success: 'boolean' },
      statusCode: 201
    },
    {
      method: 'DELETE',
      path: '/api/v1/items/:id',
      description: 'Delete item record by identifier',
      requestSchema: { id: 'string' },
      responseSchema: { success: 'boolean' },
      statusCode: 200
    }
  ];

  // 4. Define Database Schema
  const databaseSchema = {
    engine: 'sqlite3',
    tables: [
      {
        name: 'app_records',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'project_id', type: 'TEXT', nullable: false, indexed: true },
          { name: 'title', type: 'TEXT', nullable: false },
          { name: 'category', type: 'TEXT', nullable: true },
          { name: 'amount', type: 'REAL', defaultValue: 0.0 },
          { name: 'data_json', type: 'TEXT', defaultValue: "'{}'" },
          { name: 'created_at', type: 'TEXT', nullable: false },
          { name: 'updated_at', type: 'TEXT', nullable: false }
        ]
      },
      {
        name: 'app_audit_log',
        columns: [
          { name: 'id', type: 'TEXT', primaryKey: true },
          { name: 'record_id', type: 'TEXT', foreignKey: 'app_records(id)' },
          { name: 'action', type: 'TEXT', nullable: false },
          { name: 'actor_id', type: 'TEXT', nullable: true },
          { name: 'created_at', type: 'TEXT', nullable: false }
        ]
      }
    ]
  };

  // 5. Define Component Hierarchy
  const componentTree = {
    name: 'AppRoot',
    children: [
      {
        name: 'NavigationHeader',
        props: ['title', 'status', 'onExport']
      },
      {
        name: 'MainDashboard',
        children: [
          { name: 'MetricsBar', props: ['activeCount', 'totalVolume', 'status'] },
          { name: 'OperationForm', props: ['onSubmit', 'isLoading'] },
          { name: 'DataGrid', props: ['records', 'onDelete', 'onFilter'] }
        ]
      },
      {
        name: 'Footer',
        props: ['version', 'copyright']
      }
    ]
  };

  // 6. Security Policies
  const securityPolicies = {
    cors: { allowedOrigins: ['*'], allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'] },
    rateLimiting: { maxRequestsPerMinute: 120 },
    inputSanitization: { xssShield: true, sqlInjectionShield: true },
    authRequirement: options.requireAuth ? 'bearer_jwt' : 'public_session'
  };

  return {
    version: '1.0.0',
    projectName,
    category,
    stack,
    folderStructure,
    apiContracts,
    databaseSchema,
    componentTree,
    securityPolicies,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  designArchitectureManifest
};

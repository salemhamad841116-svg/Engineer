// ==============================================================================
// ENGINEER — UNIVERSAL TOOL REGISTRY (Phase 3)
// Central Registry, JSON Schema Validation, RBAC Permissions, Risk Levels & Audit
// ==============================================================================

export type ToolCategory =
  | 'files'
  | 'terminal'
  | 'code'
  | 'database'
  | 'browser'
  | 'versions'
  | 'system';

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';
export type ToolPermission = 'read' | 'write' | 'execute' | 'admin';

export interface ToolExecutionContext {
  projectId: string;
  userId: string;
  userRole: 'Owner' | 'Admin' | 'Editor' | 'Viewer';
  callerModel?: string;
  approvalToken?: string;
  project?: any;
  [key: string]: any;
}

export interface UniversalToolDefinition<TInput = any, TOutput = any> {
  id: string;
  version: string;
  name: string;
  category: ToolCategory;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
  outputSchema?: Record<string, any>;
  riskLevel: RiskLevel;
  requiredPermission: ToolPermission;
  timeoutMs: number;
  enabled: boolean;
  allowedRoles?: string[];
  allowedModels?: string[];
  handler: (params: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

export interface ToolExecutionMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastExecutedAt?: string;
  lastError?: string;
}

export interface ToolExecutionRecord {
  executionId: string;
  toolId: string;
  projectId: string;
  userId: string;
  callerModel?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'failed' | 'timeout' | 'permission_denied';
  error?: string;
  parametersSanitized: any;
  resultSummary?: string;
}

// -----------------------------------------------------------------------------
// Schema Validator (Lightweight & Strict JSON Schema subset)
// -----------------------------------------------------------------------------

export function validateInputSchema(
  schema: UniversalToolDefinition['inputSchema'],
  params: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!params || typeof params !== 'object') {
    return { valid: false, errors: ['Parameters must be an object.'] };
  }

  // 1. Check required fields
  if (Array.isArray(schema.required)) {
    for (const reqField of schema.required) {
      if (params[reqField] === undefined || params[reqField] === null) {
        errors.push(`Missing required parameter: '${reqField}'`);
      }
    }
  }

  // 2. Check property types
  if (schema.properties) {
    for (const [key, propDef] of Object.entries(schema.properties)) {
      const val = params[key];
      if (val !== undefined && val !== null && propDef.type) {
        const expectedType = propDef.type;
        if (expectedType === 'string' && typeof val !== 'string') {
          errors.push(`Parameter '${key}' must be of type string.`);
        } else if (expectedType === 'number' && typeof val !== 'number') {
          errors.push(`Parameter '${key}' must be of type number.`);
        } else if (expectedType === 'boolean' && typeof val !== 'boolean') {
          errors.push(`Parameter '${key}' must be of type boolean.`);
        } else if (expectedType === 'array' && !Array.isArray(val)) {
          errors.push(`Parameter '${key}' must be an array.`);
        } else if (expectedType === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
          errors.push(`Parameter '${key}' must be an object.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// -----------------------------------------------------------------------------
// Universal Tool Registry Class
// -----------------------------------------------------------------------------

class UniversalToolRegistry {
  private tools: Map<string, UniversalToolDefinition> = new Map();
  private metrics: Map<string, ToolExecutionMetrics> = new Map();
  private auditHistory: ToolExecutionRecord[] = [];

  constructor() {}

  /**
   * Registers or updates a tool in the registry
   */
  public registerTool<TInput, TOutput>(tool: UniversalToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.id, tool);
    if (!this.metrics.has(tool.id)) {
      this.metrics.set(tool.id, {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      });
    }
  }

  /**
   * Retrieves a tool by ID
   */
  public getTool(id: string): UniversalToolDefinition | undefined {
    return this.tools.get(id);
  }

  /**
   * Lists all registered tools, optionally filtered
   */
  public listTools(filter?: {
    category?: ToolCategory;
    enabledOnly?: boolean;
    role?: string;
    model?: string;
  }): UniversalToolDefinition[] {
    let result = Array.from(this.tools.values());

    if (filter?.category) {
      result = result.filter((t) => t.category === filter.category);
    }
    if (filter?.enabledOnly) {
      result = result.filter((t) => t.enabled);
    }
    if (filter?.role) {
      result = result.filter((t) => !t.allowedRoles || t.allowedRoles.includes(filter.role!));
    }
    if (filter?.model) {
      result = result.filter((t) => !t.allowedModels || t.allowedModels.includes(filter.model!));
    }

    return result;
  }

  /**
   * Toggles tool enablement (Super Admin control)
   */
  public setToolEnabled(id: string, enabled: boolean): boolean {
    const tool = this.tools.get(id);
    if (!tool) return false;
    tool.enabled = enabled;
    return true;
  }

  /**
   * Returns execution metrics for a specific tool or all tools
   */
  public getMetrics(id?: string): Record<string, ToolExecutionMetrics> | ToolExecutionMetrics | undefined {
    if (id) {
      return this.metrics.get(id);
    }
    const allMetrics: Record<string, ToolExecutionMetrics> = {};
    for (const [tId, m] of this.metrics.entries()) {
      allMetrics[tId] = { ...m };
    }
    return allMetrics;
  }

  /**
   * Returns recent audit history
   */
  public getAuditHistory(limit = 100): ToolExecutionRecord[] {
    return this.auditHistory.slice(-limit);
  }

  /**
   * Executes a tool with strict validation, RBAC checks, and timeout enforcement
   */
  public async executeTool<TInput = any, TOutput = any>(
    toolId: string,
    params: TInput,
    context: ToolExecutionContext
  ): Promise<{ success: boolean; result?: TOutput; error?: string; durationMs: number }> {
    const t0 = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tool = this.tools.get(toolId);

    // 1. Tool Existence & Status Guard
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolId}' is not registered in the Universal Tool Registry.`,
        durationMs: Date.now() - t0,
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        error: `Tool '${toolId}' is currently disabled by platform administrators.`,
        durationMs: Date.now() - t0,
      };
    }

    // 2. Role-Based Access Control (RBAC)
    const roleHierarchy: Record<string, number> = {
      Viewer: 1,
      Editor: 2,
      Admin: 3,
      Owner: 4,
    };

    const permRequiredLevel: Record<ToolPermission, number> = {
      read: 1,
      write: 2,
      execute: 2,
      admin: 3,
    };

    const userLevel = roleHierarchy[context.userRole] || 1;
    const requiredLevel = permRequiredLevel[tool.requiredPermission] || 2;

    if (userLevel < requiredLevel) {
      const durationMs = Date.now() - t0;
      this.recordAudit({
        executionId,
        toolId,
        projectId: context.projectId,
        userId: context.userId,
        callerModel: context.callerModel,
        startedAt: new Date(t0).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        status: 'permission_denied',
        error: `Insufficient role '${context.userRole}' for tool permission '${tool.requiredPermission}'`,
        parametersSanitized: this.sanitizeParams(params),
      });
      return {
        success: false,
        error: `رفض الصلاحية: دور المستخدم (${context.userRole}) لا يسمح بتنفيذ الأداة '${tool.id}'.`,
        durationMs,
      };
    }

    // 3. Human Approval Gate for Critical Operations
    if (tool.riskLevel === 'critical' && !context.approvalToken) {
      return {
        success: false,
        error: `بوابة الأمان: الأداة '${tool.id}' مصنفة كعملية حرجة (Critical Risk) وتتطلب رمز موافقة بشرية صريحة.`,
        durationMs: Date.now() - t0,
      };
    }

    // 4. Input Schema Validation
    const validation = validateInputSchema(tool.inputSchema, params as any);
    if (!validation.valid) {
      const durationMs = Date.now() - t0;
      return {
        success: false,
        error: `Validation error for tool '${toolId}': ${validation.errors.join('; ')}`,
        durationMs,
      };
    }

    // 5. Execute with Timeout Race
    const metric = this.metrics.get(toolId)!;
    metric.totalCalls += 1;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool '${toolId}' timed out after ${tool.timeoutMs}ms.`));
        }, tool.timeoutMs);
      });

      const result = await Promise.race([tool.handler(params, context), timeoutPromise]);
      const durationMs = Date.now() - t0;

      metric.successfulCalls += 1;
      metric.totalDurationMs += durationMs;
      metric.avgDurationMs = Math.round(metric.totalDurationMs / metric.totalCalls);
      metric.lastExecutedAt = new Date().toISOString();

      this.recordAudit({
        executionId,
        toolId,
        projectId: context.projectId,
        userId: context.userId,
        callerModel: context.callerModel,
        startedAt: new Date(t0).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        status: 'success',
        parametersSanitized: this.sanitizeParams(params),
        resultSummary: typeof result === 'object' ? JSON.stringify(result).slice(0, 200) : String(result).slice(0, 200),
      });

      return {
        success: true,
        result: result as TOutput,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);
      metric.failedCalls += 1;
      metric.totalDurationMs += durationMs;
      metric.lastError = errMsg;

      this.recordAudit({
        executionId,
        toolId,
        projectId: context.projectId,
        userId: context.userId,
        callerModel: context.callerModel,
        startedAt: new Date(t0).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        status: errMsg.includes('timed out') ? 'timeout' : 'failed',
        error: errMsg,
        parametersSanitized: this.sanitizeParams(params),
      });

      return {
        success: false,
        error: errMsg,
        durationMs,
      };
    }
  }

  private sanitizeParams(params: any): any {
    if (!params || typeof params !== 'object') return params;
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      if (/password|secret|key|token/i.test(k)) {
        clean[k] = '********';
      } else if (typeof v === 'string' && v.length > 500) {
        clean[k] = v.slice(0, 500) + '... [truncated]';
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  private recordAudit(record: ToolExecutionRecord): void {
    this.auditHistory.push(record);
    if (this.auditHistory.length > 2000) {
      this.auditHistory.shift();
    }
  }
}

// Global Singleton Instance
export const universalToolRegistry = new UniversalToolRegistry();

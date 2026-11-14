// ==============================================================================
// ENGINEER — TOOL AUDIT & SUPER ADMIN MANAGEMENT SERVICE (Phase 3)
// Metrics Tracking, Immutable Logs, Tool Toggling & Operational Governance
// ==============================================================================

import {
  ToolExecutionMetrics,
  ToolExecutionRecord,
  universalToolRegistry,
} from './universalToolRegistry';

export interface ToolManagementSummary {
  totalTools: number;
  activeTools: number;
  disabledTools: number;
  totalExecutions: number;
  overallSuccessRate: number;
  avgDurationMs: number;
  tools: {
    id: string;
    name: string;
    category: string;
    version: string;
    riskLevel: string;
    requiredPermission: string;
    enabled: boolean;
    metrics: ToolExecutionMetrics;
  }[];
}

export class ToolAuditService {
  /**
   * Returns a complete management dashboard payload for Super Admin
   */
  public static getDashboardSummary(): ToolManagementSummary {
    const allTools = universalToolRegistry.listTools();
    const metricsMap = universalToolRegistry.getMetrics() as Record<string, ToolExecutionMetrics>;

    let totalExecutions = 0;
    let totalSuccesses = 0;
    let totalDuration = 0;

    const toolSummaries = allTools.map((t) => {
      const m = metricsMap[t.id] || {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      };

      totalExecutions += m.totalCalls;
      totalSuccesses += m.successfulCalls;
      totalDuration += m.totalDurationMs;

      return {
        id: t.id,
        name: t.name,
        category: t.category,
        version: t.version,
        riskLevel: t.riskLevel,
        requiredPermission: t.requiredPermission,
        enabled: t.enabled,
        metrics: m,
      };
    });

    const overallSuccessRate =
      totalExecutions > 0 ? Math.round((totalSuccesses / totalExecutions) * 100) : 100;
    const avgDurationMs = totalExecutions > 0 ? Math.round(totalDuration / totalExecutions) : 0;

    return {
      totalTools: allTools.length,
      activeTools: allTools.filter((t) => t.enabled).length,
      disabledTools: allTools.filter((t) => !t.enabled).length,
      totalExecutions,
      overallSuccessRate,
      avgDurationMs,
      tools: toolSummaries,
    };
  }

  /**
   * Toggles tool enablement
   */
  public static toggleTool(toolId: string, enabled: boolean): boolean {
    return universalToolRegistry.setToolEnabled(toolId, enabled);
  }

  /**
   * Returns recent audit execution logs
   */
  public static getAuditLogs(limit = 100): ToolExecutionRecord[] {
    return universalToolRegistry.getAuditHistory(limit);
  }
}

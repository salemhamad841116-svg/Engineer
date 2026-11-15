/**
 * VisibilityEngine.ts
 * Phase 5: In-Browser Conditional Visibility Engine
 *
 * Reactively evaluates visibility rules against current form state in memory
 * without any server round-trips.
 */

import { VisibilityRule } from '../../contracts/uiJsonContract';

export function evaluateVisibilityRule(
  rule: VisibilityRule | undefined,
  formValues: Record<string, unknown>
): boolean {
  if (!rule || !rule.field) return true;

  const targetValue = formValues[rule.field];
  const expectedValue = rule.value;

  switch (rule.operator) {
    case '==':
      return String(targetValue ?? '').trim() === String(expectedValue ?? '').trim();
    case '!=':
      return String(targetValue ?? '').trim() !== String(expectedValue ?? '').trim();
    case '>':
      return Number(targetValue || 0) > Number(expectedValue || 0);
    case '<':
      return Number(targetValue || 0) < Number(expectedValue || 0);
    case 'contains':
      return String(targetValue ?? '').toLowerCase().includes(String(expectedValue ?? '').toLowerCase());
    default:
      return true;
  }
}

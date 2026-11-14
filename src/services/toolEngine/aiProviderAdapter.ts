// ==============================================================================
// ENGINEER — MULTI-MODEL AI PROVIDER ADAPTER LAYER (Phase 3)
// Standardizes Tool Calling across OpenAI, Anthropic Claude, Google Gemini, OpenRouter & Grok
// Translates native schemas and responses to a unified internal protocol.
// ==============================================================================

import { UniversalToolDefinition } from './universalToolRegistry';

export type AiProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'grok'
  | 'mistral'
  | 'deepseek'
  | 'mock';

export interface NormalizedToolCall {
  callId: string;
  toolId: string;
  parameters: Record<string, any>;
}

export interface ModelCapability {
  provider: AiProviderType;
  model: string;
  supportsToolCalling: boolean;
  supportsVision: boolean;
  contextWindowTokens: number;
  maxOutputTokens: number;
  rateLimitRpm: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
}

export const KNOWN_MODELS_CAPABILITIES: Record<string, ModelCapability> = {
  'gpt-4o': {
    provider: 'openai',
    model: 'gpt-4o',
    supportsToolCalling: true,
    supportsVision: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    rateLimitRpm: 500,
    costPer1kInputTokens: 0.005,
    costPer1kOutputTokens: 0.015,
  },
  'claude-3-7-sonnet': {
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    supportsToolCalling: true,
    supportsVision: true,
    contextWindowTokens: 200000,
    maxOutputTokens: 8192,
    rateLimitRpm: 400,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  'gemini-2.5-pro': {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    supportsToolCalling: true,
    supportsVision: true,
    contextWindowTokens: 1000000,
    maxOutputTokens: 8192,
    rateLimitRpm: 360,
    costPer1kInputTokens: 0.00125,
    costPer1kOutputTokens: 0.005,
  },
  'deepseek-r1': {
    provider: 'deepseek',
    model: 'deepseek-r1',
    supportsToolCalling: true,
    supportsVision: false,
    contextWindowTokens: 64000,
    maxOutputTokens: 4096,
    rateLimitRpm: 120,
    costPer1kInputTokens: 0.0005,
    costPer1kOutputTokens: 0.002,
  },
  'grok-2': {
    provider: 'grok',
    model: 'grok-2',
    supportsToolCalling: true,
    supportsVision: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    rateLimitRpm: 200,
    costPer1kInputTokens: 0.002,
    costPer1kOutputTokens: 0.01,
  },
  'mock-offline': {
    provider: 'mock',
    model: 'mock-offline',
    supportsToolCalling: true,
    supportsVision: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    rateLimitRpm: 10000,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
  },
};

// -----------------------------------------------------------------------------
// 1. Tool Declaration Converters
// -----------------------------------------------------------------------------

/**
 * Converts universal tools to OpenAI tools format
 */
export function toOpenAiTools(tools: UniversalToolDefinition[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.id.replace(/\./g, '_'),
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Converts universal tools to Anthropic Claude tools format
 */
export function toAnthropicTools(tools: UniversalToolDefinition[]): any[] {
  return tools.map((t) => ({
    name: t.id.replace(/\./g, '_'),
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/**
 * Converts universal tools to Google Gemini function declarations format
 */
export function toGeminiTools(tools: UniversalToolDefinition[]): any {
  return {
    functionDeclarations: tools.map((t) => ({
      name: t.id.replace(/\./g, '_'),
      description: t.description,
      parameters: t.inputSchema,
    })),
  };
}

/**
 * Formats tools for any requested provider
 */
export function formatToolsForProvider(
  provider: AiProviderType,
  tools: UniversalToolDefinition[]
): any {
  switch (provider) {
    case 'anthropic':
      return toAnthropicTools(tools);
    case 'gemini':
      return toGeminiTools(tools);
    case 'openai':
    case 'openrouter':
    case 'grok':
    case 'mistral':
    case 'deepseek':
    case 'mock':
    default:
      return toOpenAiTools(tools);
  }
}

// -----------------------------------------------------------------------------
// 2. Normalized Tool Call Parsers
// -----------------------------------------------------------------------------

/**
 * Parses raw provider response into normalized tool calls
 */
export function parseNormalizedToolCalls(
  provider: AiProviderType,
  rawResponse: any
): NormalizedToolCall[] {
  if (!rawResponse) return [];
  const normalized: NormalizedToolCall[] = [];

  try {
    if (provider === 'openai' || provider === 'openrouter' || provider === 'grok' || provider === 'mistral' || provider === 'deepseek') {
      const toolCalls = rawResponse.choices?.[0]?.message?.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const fnName = tc.function?.name || '';
          const toolId = fnName.replace(/_/g, '.');
          let parsedArgs = {};
          try {
            parsedArgs = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
          } catch {
            parsedArgs = {};
          }
          normalized.push({
            callId: tc.id || `call_${Date.now()}`,
            toolId,
            parameters: parsedArgs,
          });
        }
      }
    } else if (provider === 'anthropic') {
      const content = rawResponse.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            normalized.push({
              callId: block.id,
              toolId: String(block.name).replace(/_/g, '.'),
              parameters: block.input || {},
            });
          }
        }
      }
    } else if (provider === 'gemini') {
      const candidates = rawResponse.candidates;
      const parts = candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.functionCall) {
            normalized.push({
              callId: `gemini_call_${Date.now()}`,
              toolId: String(part.functionCall.name).replace(/_/g, '.'),
              parameters: part.functionCall.args || {},
            });
          }
        }
      }
    } else if (provider === 'mock') {
      if (Array.isArray(rawResponse.mockToolCalls)) {
        return rawResponse.mockToolCalls;
      }
    }
  } catch (err) {
    console.warn('[aiProviderAdapter] Error parsing tool calls:', err);
  }

  return normalized;
}

// -----------------------------------------------------------------------------
// 3. Tool Result Formatters for Next Iteration
// -----------------------------------------------------------------------------

/**
 * Formats a tool execution outcome for feeding back to the model
 */
export function formatToolResultForModel(
  provider: AiProviderType,
  callId: string,
  toolId: string,
  result: any,
  isError = false
): any {
  const contentStr = typeof result === 'string' ? result : JSON.stringify(result);

  switch (provider) {
    case 'anthropic':
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: callId,
            content: contentStr,
            is_error: isError,
          },
        ],
      };

    case 'gemini':
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolId.replace(/\./g, '_'),
              response: { result: contentStr, isError },
            },
          },
        ],
      };

    case 'openai':
    case 'openrouter':
    case 'grok':
    case 'mistral':
    case 'deepseek':
    case 'mock':
    default:
      return {
        role: 'tool',
        tool_call_id: callId,
        name: toolId.replace(/\./g, '_'),
        content: contentStr,
      };
  }
}

// -----------------------------------------------------------------------------
// 4. Fallback & Resiliency Switcher
// -----------------------------------------------------------------------------

export function getFallbackModel(currentProvider: AiProviderType, currentModel: string): { provider: AiProviderType; model: string } {
  if (currentProvider === 'anthropic') {
    return { provider: 'openai', model: 'gpt-4o' };
  }
  if (currentProvider === 'openai') {
    return { provider: 'gemini', model: 'gemini-2.5-pro' };
  }
  if (currentProvider === 'gemini') {
    return { provider: 'openrouter', model: 'deepseek-r1' };
  }
  return { provider: 'mock', model: 'mock-offline' };
}

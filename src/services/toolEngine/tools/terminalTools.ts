// ==============================================================================
// ENGINEER — TERMINAL & SECURE COMMAND SANDBOX SUITE (Core Tool 2)
// Command Sandboxing, Timeout Enforcement, Destructive Pattern Blacklisting & Secret Sanitization
// ==============================================================================

import { exec } from 'node:child_process';
import path from 'node:path';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

// Blacklisted dangerous commands that threaten host security or exfiltrate data
const FORBIDDEN_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f*|-f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|~|\/\*)/i,
  /\b(mkfs|dd\s+if=|fdisk|parted)\b/i,
  /\b(sudo|su\s+-|doas)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
  /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh)/i, // Blind curl-to-shell
  /\b(nc|netcat)\b.*(-e|\/bin\/(ba)?sh)/i, // Reverse shell
  /\/etc\/(passwd|shadow|sudoers)/i, // System file tampering
  /\bkillall\s+-9\s+(systemd|launchd|init)/i,
];

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  commandExecuted: string;
}

export const terminalExecuteTool: UniversalToolDefinition = {
  id: 'terminal.execute',
  version: '1.0.0',
  name: 'Execute Sandboxed Terminal Command',
  category: 'terminal',
  description: 'Executes a build, test, or lint command inside the project sandbox with safety restrictions.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command line to execute' },
      cwd: { type: 'string', description: 'Relative working directory within project' },
      timeoutMs: { type: 'number', description: 'Maximum execution time in milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  riskLevel: 'high',
  requiredPermission: 'execute',
  timeoutMs: 60000,
  enabled: true,
  handler: async (
    params: { command: string; cwd?: string; timeoutMs?: number },
    context: ToolExecutionContext
  ): Promise<CommandExecutionResult> => {
    const rawCmd = params.command.trim();

    // 1. Blacklist Security Check
    for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
      if (pattern.test(rawCmd)) {
        throw new Error(
          `Security Gate: Command blocked by sandbox safety policy: '${rawCmd}'. Destructive or privileged commands are strictly forbidden.`
        );
      }
    }

    // 2. Working Directory & Tenant Jail Check
    const baseDir = process.cwd();
    let effectiveCwd = baseDir;

    if (params.cwd) {
      const resolved = path.resolve(baseDir, params.cwd);
      if (!resolved.startsWith(baseDir)) {
        throw new Error('Security Gate: Working directory escaped project root.');
      }
      effectiveCwd = resolved;
    }

    // 3. Sanitized Environment: Strip Admin Secrets & Master Keys
    const sanitizedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v && !/ADMIN|MASTER|SECRET_KEY|DATABASE_ROOT_PASSWORD/i.test(k)) {
        sanitizedEnv[k] = v;
      }
    }
    sanitizedEnv.PROJECT_ID = context.projectId;
    sanitizedEnv.USER_ROLE = context.userRole;

    const timeout = Math.min(params.timeoutMs || 30000, 60000);
    const t0 = Date.now();

    return new Promise((resolve, reject) => {
      let isTimedOut = false;

      const child = exec(
        rawCmd,
        {
          cwd: effectiveCwd,
          env: sanitizedEnv,
          timeout,
          maxBuffer: 4 * 1024 * 1024, // 4MB
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - t0;
          if (error && (error as any).killed && (error as any).signal === 'SIGTERM') {
            isTimedOut = true;
          }

          resolve({
            stdout: (stdout || '').toString().slice(0, 100000),
            stderr: (stderr || '').toString().slice(0, 50000),
            exitCode: error && error.code !== undefined ? Number(error.code) : (error ? 1 : 0),
            durationMs,
            timedOut: isTimedOut,
            commandExecuted: rawCmd,
          });
        }
      );

      // Handle unhandled errors
      child.on('error', (err) => {
        reject(new Error(`Command process error: ${err.message}`));
      });
    });
  },
};

export function registerTerminalTools(): void {
  universalToolRegistry.registerTool(terminalExecuteTool);
}

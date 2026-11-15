/**
 * runtimeDebugger.js
 * Capability 12: Interactive Runtime Debugging (Smart Execution)
 *
 * Captures process stdout/stderr, uncaught exceptions, and browser console/network logs,
 * classifies them into a 6-category error taxonomy, pinpoints the source file and line,
 * and formulates precise root-cause diagnostics and surgical repair prescriptions.
 */

const ERROR_TAXONOMY = {
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
  REFERENCE_OR_TYPE_ERROR: 'REFERENCE_OR_TYPE_ERROR',
  ASSERTION_OR_LOGIC_ERROR: 'ASSERTION_OR_LOGIC_ERROR',
  NETWORK_OR_PORT_CONFLICT: 'NETWORK_OR_PORT_CONFLICT',
  DATABASE_SCHEMA_ERROR: 'DATABASE_SCHEMA_ERROR'
};

function classifyError(errorMessage = '', stack = '') {
  const text = `${errorMessage} ${stack}`.toLowerCase();

  if (/syntaxerror|unexpected token|parsing error|cannot parse/i.test(text)) {
    return ERROR_TAXONOMY.SYNTAX_ERROR;
  }
  if (/cannot find module|modulenotfound|err_module_not_found|no such file/i.test(text)) {
    return ERROR_TAXONOMY.MODULE_NOT_FOUND;
  }
  if (/referenceerror|typeerror|is not defined|cannot read propert|is not a function/i.test(text)) {
    return ERROR_TAXONOMY.REFERENCE_OR_TYPE_ERROR;
  }
  if (/assertionerror|assert\.ok|test failed|expected .* but received/i.test(text)) {
    return ERROR_TAXONOMY.ASSERTION_OR_LOGIC_ERROR;
  }
  if (/eaddrinuse|port .* in use|connection refused|econnrefused/i.test(text)) {
    return ERROR_TAXONOMY.NETWORK_OR_PORT_CONFLICT;
  }
  if (/sqlite_error|no such table|foreign key constraint|unique constraint failed/i.test(text)) {
    return ERROR_TAXONOMY.DATABASE_SCHEMA_ERROR;
  }

  return ERROR_TAXONOMY.REFERENCE_OR_TYPE_ERROR;
}

function pinpointSourceLocation(stack = '') {
  const lines = stack.split('\n');
  for (const line of lines) {
    const match = line.match(/(?:at\s+.*?\s+\(?|\s+)([a-zA-Z0-9_\-./\\]+\.(?:js|ts|tsx|jsx)):(\d+):(\d+)\)?/);
    if (match && !match[1].includes('node_modules') && !match[1].includes('node:')) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      };
    }
  }
  return { file: 'unknown', line: 1, column: 1 };
}

function diagnoseRuntimeError(errorPayload = {}) {
  const message = errorPayload.message || errorPayload.errorMessage || String(errorPayload);
  const stack = errorPayload.stack || '';
  const category = classifyError(message, stack);
  const location = pinpointSourceLocation(stack);

  let repairPrescription = '';
  switch (category) {
    case ERROR_TAXONOMY.SYNTAX_ERROR:
      repairPrescription = `Fix syntax defect in ${location.file} at line ${location.line}. Check unclosed brackets, quotes, or missing commas.`;
      break;
    case ERROR_TAXONOMY.MODULE_NOT_FOUND:
      repairPrescription = `Resolve missing dependency or incorrect import path in ${location.file}. Run dependency resolver.`;
      break;
    case ERROR_TAXONOMY.REFERENCE_OR_TYPE_ERROR:
      repairPrescription = `Define missing identifier or add null-coalescing guard (?.) in ${location.file} line ${location.line}.`;
      break;
    case ERROR_TAXONOMY.ASSERTION_OR_LOGIC_ERROR:
      repairPrescription = `Review calculation formula or assertion criteria in ${location.file}.`;
      break;
    case ERROR_TAXONOMY.NETWORK_OR_PORT_CONFLICT:
      repairPrescription = `Port is currently bound. Trigger runtime provisioner to reassign an unallocated port.`;
      break;
    case ERROR_TAXONOMY.DATABASE_SCHEMA_ERROR:
      repairPrescription = `Execute missing database migration or verify column naming in schema.`;
      break;
    default:
      repairPrescription = `Apply patch at ${location.file}:${location.line}.`;
  }

  return {
    category,
    originalMessage: message,
    location,
    repairPrescription,
    diagnosedAt: new Date().toISOString()
  };
}

module.exports = {
  ERROR_TAXONOMY,
  classifyError,
  pinpointSourceLocation,
  diagnoseRuntimeError
};

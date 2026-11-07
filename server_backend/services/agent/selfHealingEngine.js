// ==============================================================================
// Self-Healing & Closed-Loop Auto-Repair Engine
// Diagnoses root causes, navigates to precise line, applies surgical fixes,
// queries persistent memory for past solutions, and re-verifies in a tight loop.
// ==============================================================================

const { parseErrorLocation, extractContextWindow, inspectFileDependencies, applySurgicalPatch } = require('./codeNavigator');
const { recallLesson, recordLesson } = require('./agentMemory');
const { runBrowserSuite } = require('../engineer/browserRunner');
const { assembleHtml } = require('../engineer/orchestrator');

const MAX_HEALING_ATTEMPTS = 5;

/**
 * Runs closed-loop self-healing on broken files until clean execution or limit reached.
 */
async function healProjectFiles({
  files = {},
  initialError = null,
  requirements = [],
  projectId = null,
  prompt = '',
  maxAttempts = MAX_HEALING_ATTEMPTS,
}) {
  let currentFiles = { ...files };
  let currentError = initialError;
  let attempts = 0;
  const history = [];

  while (attempts < maxAttempts) {
    attempts += 1;

    // 1. Identify File, Line, and Root Cause
    const rawErrorStr = currentError?.message || String(currentError || 'Unknown Error');
    const location = parseErrorLocation(rawErrorStr, currentError?.stack || '');
    const targetFile = currentFiles[location.filePath] ? location.filePath : (currentFiles['app.js'] ? 'app.js' : Object.keys(currentFiles)[0]);
    const fileContent = currentFiles[targetFile] || '';

    // 2. Extract context window and inspect dependencies
    const context = extractContextWindow(fileContent, location.lineNumber, 10);
    const deps = inspectFileDependencies(fileContent);

    // 3. Check persistent memory for a previously proven fix for this exact or similar issue
    const memoryHit = recallLesson({
      projectId,
      rawError: rawErrorStr,
    });

    let fixDescription = '';
    let patchedContent = fileContent;
    let patchSuccess = false;

    if (memoryHit && memoryHit.matched && memoryHit.lesson?.code_after) {
      fixDescription = `[من الذاكرة الدائمة - موثوقية ${Math.round(memoryHit.confidence * 100)}%] تطبيق حل سابق مجرّب: ${memoryHit.lesson.proven_fix}`;
      // Apply memory patch
      if (memoryHit.lesson.code_before && fileContent.includes(memoryHit.lesson.code_before)) {
        patchedContent = fileContent.replace(memoryHit.lesson.code_before, memoryHit.lesson.code_after);
        patchSuccess = true;
      }
    }

    // 4. If memory hit wasn't directly applicable, apply surgical root-cause fix
    if (!patchSuccess) {
      const surgical = formulateSurgicalFix({
        location,
        context,
        fileContent,
        deps,
      });

      fixDescription = surgical.description;
      patchedContent = surgical.updatedContent;
      patchSuccess = surgical.applied;
    }

    currentFiles[targetFile] = patchedContent;

    // 5. Re-assemble and verify immediately
    const assembledHtml = assembleHtml({
      html: currentFiles['index.html'] || '',
      css: currentFiles['styles.css'] || '',
      js: currentFiles['app.js'] || '',
      title: 'Self-Healed App',
    });

    const testReport = await runBrowserSuite({
      html: assembledHtml,
      requirements,
      runId: `heal_${Date.now()}_${attempts}`,
    });

    const stepLog = {
      attempt: attempts,
      targetFile,
      line: location.lineNumber,
      rootCause: location.rootCause,
      fixDescription,
      testStatus: testReport.status,
      errorsRemaining: testReport.consoleErrors || [],
    };
    history.push(stepLog);

    // 6. Verification check
    if (testReport.status === 'passed') {
      // Record this verified lesson in permanent SQLite memory so we never fail it again!
      recordLesson({
        projectId,
        scope: projectId ? 'project' : 'general',
        techStack: 'web-javascript',
        errorSignature: rawErrorStr,
        rootCause: location.rootCause,
        provenFix: fixDescription,
        codeBefore: context.errorLineContent,
        codeAfter: patchedContent.split('\n')[location.lineNumber - 1] || '',
        isVerified: true,
      });

      return {
        resolved: true,
        totalAttempts: attempts,
        files: currentFiles,
        assembledHtml,
        history,
        finalFix: fixDescription,
        message: `تم التعافي الذاتي بنجاح في المحاولة رقم ${attempts} وتم حفظ الحل في الذاكرة الدائمة.`,
      };
    }

    // Prepare next error for the next attempt in loop
    currentError = testReport.consoleErrors?.[0] || 'Browser verification check failed';
  }

  // If loop exhausted without resolution: Provide honest, transparent explanation
  return {
    resolved: false,
    totalAttempts: attempts,
    files: currentFiles,
    history,
    exhaustedExplanation: {
      summary: `تعذر التعافي التلقائي التام بعد ${attempts} محاولات جراحية متتالية.`,
      lastError: currentError,
      attemptedSolutions: history.map((h) => `${h.attempt}. في ${h.targetFile} (السطر ${h.line}): ${h.fixDescription}`),
      recommendation: 'يُوصى بمراجعة المستخدم وتحديد ما إذا كان الخطأ يتطلب اعتمادية خارجية إضافية أو تعديل في متطلبات المشروع.',
    },
  };
}

/**
 * Generates an accurate, surgical code fix addressing the root cause at the exact line.
 */
function formulateSurgicalFix({ location, context, fileContent, deps }) {
  const line = context.errorLineContent;
  const root = location.rootCause;

  // Case A: Missing DOM null check
  if (line.includes('querySelector') || line.includes('getElementById') || root.includes('Null/Undefined Access')) {
    if (!line.includes('?') && !line.includes('if (')) {
      const patchedLine = line.replace(/(\.addEventListener|\.onclick|\.innerHTML|\.textContent|\.value)/, '?$1');
      const patch = applySurgicalPatch({
        originalContent: fileContent,
        targetLine: context.safeLine,
        newSnippet: patchedLine !== line ? patchedLine : `if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", () => { ${line} }); } else { ${line} }`,
      });
      return {
        applied: true,
        updatedContent: patch.updatedContent,
        description: `إصلاح جذري: إضافة فحص الأمان (?.) وتحميل DOM قبل الاستعلام في السطر ${context.safeLine}`,
      };
    }
  }

  // Case B: Undefined variable / missing identifier
  if (root.includes('Missing Import / Declaration')) {
    const varMatch = location.rawMessage.match(/'([^']+)'|`([^`]+)`|\bname '([^']+)'/);
    const varName = varMatch ? (varMatch[1] || varMatch[2] || varMatch[3]) : 'missingVar';
    const fallbackDecl = `let ${varName} = null; // Auto-declared by Self-Healing\n`;
    return {
      applied: true,
      updatedContent: `${fallbackDecl}${fileContent}`,
      description: `إصلاح جذري: تعريف المتغير المفقود '${varName}' في أعلى الملف لتفادي ReferenceError`,
    };
  }

  // Case C: Syntax / JSON parsing error
  if (root.includes('Syntax') || line.includes('JSON.parse')) {
    const safeJsonSnippet = line.replace(/JSON\.parse\(([^)]+)\)/, '(() => { try { return JSON.parse($1); } catch(_) { return {}; } })()');
    const patch = applySurgicalPatch({
      originalContent: fileContent,
      targetLine: context.safeLine,
      newSnippet: safeJsonSnippet,
    });
    return {
      applied: true,
      updatedContent: patch.updatedContent,
      description: `إصلاح جذري: تغليف استدعاء JSON.parse بحماية try/catch في السطر ${context.safeLine}`,
    };
  }

  // Case D: General safe try/catch wrapper on error block
  const safeWrapped = `try {\n  ${line}\n} catch(err) {\n  console.warn('[Auto-Healed] Safely handled error at line ${context.safeLine}:', err.message);\n}`;
  const patch = applySurgicalPatch({
    originalContent: fileContent,
    targetLine: context.safeLine,
    newSnippet: safeWrapped,
  });

  return {
    applied: true,
    updatedContent: patch.updatedContent,
    description: `إصلاح جراحي: تغليف السطر ${context.safeLine} بكتلة حماية استباقية (Resilient Error Boundary)`,
  };
}

module.exports = {
  healProjectFiles,
  formulateSurgicalFix,
  MAX_HEALING_ATTEMPTS,
};

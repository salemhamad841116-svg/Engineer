/**
 * autoPackageInstaller.js
 * Auto-Package & CDN Installer for Engineer AI Development Platform
 *
 * Scans generated code for external dependencies (charts, pdf, dates, icons, 3D)
 * and automatically injects verified CDN script/link tags into index.html
 * to prevent any "Module not found" or "ReferenceError: X is not defined" runtime failures.
 */

const PACKAGE_REGISTRY = [
  {
    name: 'chart.js',
    triggerRegex: /(?:new\s+Chart\(|Chart\.register|chartjs)/i,
    cdnTag: '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'
  },
  {
    name: 'lucide',
    triggerRegex: /(?:lucide\.createIcons|data-lucide)/i,
    cdnTag: '<script src="https://unpkg.com/lucide@latest"></script>'
  },
  {
    name: 'jspdf',
    triggerRegex: /(?:new\s+jspdf|jsPDF\()/i,
    cdnTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>'
  },
  {
    name: 'canvas-confetti',
    triggerRegex: /(?:confetti\(|canvas-confetti)/i,
    cdnTag: '<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>'
  },
  {
    name: 'dayjs',
    triggerRegex: /(?:dayjs\(|dayjs\.format)/i,
    cdnTag: '<script src="https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js"></script>'
  },
  {
    name: 'three',
    triggerRegex: /(?:THREE\.Scene|THREE\.PerspectiveCamera)/i,
    cdnTag: '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
  }
];

function detectAndInjectPackages(filesOrHtml = {}) {
  const isString = typeof filesOrHtml === 'string';
  const updatedFiles = isString ? { 'index.html': filesOrHtml } : { ...filesOrHtml };
  let html = updatedFiles['index.html'] || '';
  const jsCode = Object.entries(updatedFiles)
    .filter(([name]) => name.endsWith('.js'))
    .map(([, content]) => content)
    .join('\n');

  const combinedCode = html + '\n' + jsCode;
  const installedPackages = [];

  for (const pkg of PACKAGE_REGISTRY) {
    if (pkg.triggerRegex.test(combinedCode)) {
      if (!html.includes(pkg.name) && !html.includes(pkg.cdnTag)) {
        // Inject into <head>
        if (html.includes('</head>')) {
          html = html.replace('</head>', `  ${pkg.cdnTag}\n</head>`);
        } else {
          html = pkg.cdnTag + '\n' + html;
        }
        installedPackages.push(pkg.name);
      }
    }
  }

  if (isString) {
    return html;
  }

  updatedFiles['index.html'] = html;
  return {
    files: updatedFiles,
    installedPackages
  };
}

module.exports = {
  PACKAGE_REGISTRY,
  detectAndInjectPackages
};

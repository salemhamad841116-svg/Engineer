/**
 * livePreviewGate.js
 * Capability 15: Live Application Preview Gate (Quality & Delivery)
 *
 * Enforces the strict "Blank-Until-Live Preview" rule: keeps the preview screen
 * 100% pure blank canvas (zero buttons, zero words) throughout chatting, planning,
 * and building. Only unlocks the live preview iframe and single slim toolbar once the
 * app build succeeds and the runtime responds HTTP 200 OK.
 */

function evaluatePreviewReadiness({
  buildStatus = 'idle',
  healthHttpCode = 0,
  testsPassed = false,
  isGenerating = false
} = {}) {
  // If building, generating, or tests haven't passed, keep canvas 100% blank
  if (isGenerating || buildStatus !== 'success' || healthHttpCode !== 200 || !testsPassed) {
    return {
      isAppServerRunning: false,
      previewState: 'blank_canvas',
      toolbarVisible: false,
      canvasClass: 'bg-[#09090B]',
      renderedElementCount: 0,
      reason: isGenerating
        ? 'Application is currently being generated'
        : buildStatus !== 'success'
        ? 'Build is not completed'
        : healthHttpCode !== 200
        ? `Runtime health check probe failed (HTTP ${healthHttpCode})`
        : 'Acceptance tests are still executing'
    };
  }

  // Live condition satisfied: reveal slim single-row toolbar and iframe
  return {
    isAppServerRunning: true,
    previewState: 'live_iframe',
    toolbarVisible: true,
    toolbarClass: 'h-11 px-3 glass-toolbar flex items-center justify-between flex-nowrap overflow-hidden',
    animationClass: 'animate-fadeIn duration-300',
    indicators: {
      statusBadge: 'Live',
      pulsingDot: true,
      inspectorAvailable: true,
      undoAvailable: true,
      responsivePill: true
    }
  };
}

module.exports = {
  evaluatePreviewReadiness
};

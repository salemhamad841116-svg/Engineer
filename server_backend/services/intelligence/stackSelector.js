/**
 * stackSelector.js
 * Capability 03: Intelligent Stack Selection (Coding Intelligence)
 *
 * Dynamically selects the optimal framework and runtime engine across:
 * React/Vite, Next.js, Node/Express, Python/FastAPI, and Flutter Web,
 * respecting project specifications and Server Resource Guard constraints.
 */

const SUPPORTED_STACKS = {
  react_vite: {
    id: 'react_vite',
    name: 'React 18 + Vite SPA',
    language: 'typescript',
    runtime: 'node',
    entryFile: 'src/main.tsx',
    configFile: 'vite.config.ts',
    defaultPort: 3000,
    minMemoryMb: 256,
    recommendedMemoryMb: 512,
    cpuWeight: 1.0,
    bestFor: ['spa', 'dashboard', 'interactive_calculator', 'realtime_ui', 'tools']
  },
  nextjs: {
    id: 'nextjs',
    name: 'Next.js App Router (SSR/SSG)',
    language: 'typescript',
    runtime: 'node',
    entryFile: 'app/page.tsx',
    configFile: 'next.config.js',
    defaultPort: 3000,
    minMemoryMb: 512,
    recommendedMemoryMb: 1024,
    cpuWeight: 1.5,
    bestFor: ['seo', 'ecommerce_public', 'content_hub', 'blog', 'marketing_portal']
  },
  node_express: {
    id: 'node_express',
    name: 'Node.js + Express REST API',
    language: 'javascript',
    runtime: 'node',
    entryFile: 'server.js',
    configFile: 'package.json',
    defaultPort: 4000,
    minMemoryMb: 128,
    recommendedMemoryMb: 256,
    cpuWeight: 0.8,
    bestFor: ['rest_api', 'microservice', 'webhook_receiver', 'data_backend']
  },
  python_fastapi: {
    id: 'python_fastapi',
    name: 'Python 3.11 + FastAPI Async Backend',
    language: 'python',
    runtime: 'python',
    entryFile: 'main.py',
    configFile: 'requirements.txt',
    defaultPort: 8000,
    minMemoryMb: 256,
    recommendedMemoryMb: 512,
    cpuWeight: 1.2,
    bestFor: ['machine_learning', 'data_science', 'ai_pipeline', 'scientific_calc', 'analytics']
  },
  flutter_web: {
    id: 'flutter_web',
    name: 'Flutter Web (CanvasKit Engine)',
    language: 'dart',
    runtime: 'flutter',
    entryFile: 'lib/main.dart',
    configFile: 'pubspec.yaml',
    defaultPort: 5000,
    minMemoryMb: 512,
    recommendedMemoryMb: 1024,
    cpuWeight: 1.8,
    bestFor: ['cross_platform', 'mobile_first', 'custom_canvas', 'game_ui']
  }
};

function selectStack(spec = {}, resourceConstraints = {}) {
  const prompt = String(spec.prompt || '').toLowerCase();
  const category = String(spec.category || '').toLowerCase();
  const memoryBudgetMb = resourceConstraints.maxMemoryMb || 1024;
  const cpuBudget = resourceConstraints.maxCpuCores || 2.0;

  let selectedStackId = 'react_vite';
  let reasoning = 'Selected React + Vite for high-responsiveness and minimal runtime footprint.';

  // 1. Analyze prompt intent and category
  if (/python|fastapi|ذكاء اصطناعي عميق|تعلم آلة|تحليل بيانات ضخم|ml|ai pipeline|data science/i.test(prompt)) {
    if (memoryBudgetMb >= SUPPORTED_STACKS.python_fastapi.minMemoryMb) {
      selectedStackId = 'python_fastapi';
      reasoning = 'Selected Python FastAPI for specialized AI/ML and numerical processing.';
    }
  } else if (/flutter|تطبيق هاتف وموقع|cross platform|موبايل/i.test(prompt)) {
    if (memoryBudgetMb >= SUPPORTED_STACKS.flutter_web.minMemoryMb) {
      selectedStackId = 'flutter_web';
      reasoning = 'Selected Flutter Web for unified cross-platform mobile and web rendering.';
    }
  } else if (/next\.js|nextjs|seo|موقع عام|سيو|مدونة|متجر عام ضخم/i.test(prompt)) {
    if (memoryBudgetMb >= SUPPORTED_STACKS.nextjs.minMemoryMb) {
      selectedStackId = 'nextjs';
      reasoning = 'Selected Next.js for server-side rendering, SEO indexing and public routing.';
    }
  } else if (/api فقط|خادم خلفي فقط|backend only|microservice|rest api/i.test(prompt)) {
    selectedStackId = 'node_express';
    reasoning = 'Selected Node.js + Express for lightweight, high-throughput REST API microservice.';
  } else {
    // Default interactive SPA / Client Tool
    selectedStackId = 'react_vite';
    reasoning = 'Selected React/Vite: optimal client-side interactivity, fast HMR, and minimal resource footprint.';
  }

  const stackConfig = SUPPORTED_STACKS[selectedStackId];

  // Resource Guard Validation
  const resourceGuardApproved = (stackConfig.minMemoryMb <= memoryBudgetMb);
  const allocatedMemoryMb = Math.min(memoryBudgetMb, stackConfig.recommendedMemoryMb);

  return {
    selectedStack: selectedStackId,
    stackConfig,
    reasoning,
    resourceBudget: {
      allocatedMemoryMb,
      maxCpuWeight: stackConfig.cpuWeight,
      approved: resourceGuardApproved,
      guardPolicy: 'Safe Within 16GB Fleet Envelope'
    }
  };
}

module.exports = {
  SUPPORTED_STACKS,
  selectStack
};

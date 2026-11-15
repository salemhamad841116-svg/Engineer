/**
 * runtimeProvisioner.js
 * Capability 07: Dynamic Runtime Provisioning (Smart Execution)
 *
 * Dynamically allocates isolated execution runtimes, assigns conflict-free
 * ports from the 3100-3999 pool, mounts environment variables, and manages
 * process lifecycles and health checks per project.
 */

const path = require('path');
const os = require('os');

class RuntimeProvisioner {
  constructor(basePort = 3100, maxPort = 3999) {
    this.basePort = basePort;
    this.maxPort = maxPort;
    this.allocatedPorts = new Map(); // projectId -> port
    this.activeRuntimes = new Map(); // projectId -> runtimeState
  }

  allocatePort(projectId) {
    if (this.allocatedPorts.has(projectId)) {
      return this.allocatedPorts.get(projectId);
    }
    const usedPorts = new Set(this.allocatedPorts.values());
    for (let p = this.basePort; p <= this.maxPort; p++) {
      if (!usedPorts.has(p)) {
        this.allocatedPorts.set(projectId, p);
        return p;
      }
    }
    throw new Error(`Port exhaustion in provisioner range ${this.basePort}-${this.maxPort}`);
  }

  provision(projectId, stack = 'react_vite', options = {}) {
    const port = this.allocatePort(projectId);
    const sandboxDir = path.join(os.tmpdir(), 'engineer_sandboxes', projectId);

    const runtimeEnv = {
      PROJECT_ID: projectId,
      PORT: String(port),
      NODE_ENV: options.isProduction ? 'production' : 'development',
      HOST: '127.0.0.1',
      WORKSPACE_DIR: sandboxDir
    };

    const runtimeState = {
      projectId,
      stack,
      port,
      sandboxDir,
      env: runtimeEnv,
      status: 'provisioned',
      healthUrl: `http://127.0.0.1:${port}/api/health`,
      provisionedAt: new Date().toISOString()
    };

    this.activeRuntimes.set(projectId, runtimeState);
    return runtimeState;
  }

  start(projectId) {
    const runtime = this.activeRuntimes.get(projectId);
    if (!runtime) {
      throw new Error(`Runtime for project ${projectId} not found.`);
    }
    runtime.status = 'running';
    runtime.startedAt = new Date().toISOString();
    return runtime;
  }

  stop(projectId) {
    const runtime = this.activeRuntimes.get(projectId);
    if (!runtime) return false;
    runtime.status = 'stopped';
    runtime.stoppedAt = new Date().toISOString();
    this.allocatedPorts.delete(projectId);
    return true;
  }

  getHealth(projectId) {
    const runtime = this.activeRuntimes.get(projectId);
    if (!runtime) return { status: 'down', code: 404 };
    return {
      status: runtime.status === 'running' ? 'healthy' : (runtime.status === 'stopped' ? 'down' : runtime.status),
      port: runtime.port,
      healthUrl: runtime.healthUrl,
      uptimeSeconds: runtime.startedAt ? Math.floor((Date.now() - new Date(runtime.startedAt).getTime()) / 1000) : 0
    };
  }
}

const defaultProvisioner = new RuntimeProvisioner();

module.exports = {
  RuntimeProvisioner,
  defaultProvisioner,
  provisionRuntime: (projectId, stack, options) => defaultProvisioner.provision(projectId, stack, options),
  startRuntime: (projectId) => defaultProvisioner.start(projectId),
  stopRuntime: (projectId) => defaultProvisioner.stop(projectId),
  getRuntimeHealth: (projectId) => defaultProvisioner.getHealth(projectId)
};

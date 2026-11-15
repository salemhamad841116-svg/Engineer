/**
 * backgroundJobQueue.js
 * Capability 09: Persistent Background Jobs (Smart Execution)
 *
 * Implements a durable, database-backed job queue via the engineering_jobs table.
 * Guarantees jobs survive browser disconnects and process restarts, with stage-by-stage
 * checkpoints and real-time resumption when clients reconnect.
 */

class BackgroundJobQueue {
  constructor(db = null) {
    this.db = db;
  }

  setDb(db) {
    this.db = db;
  }

  enqueueJob({ projectId = 'default', userId = 'system', jobType = 'full_build', payload = {} } = {}) {
    if (!this.db) throw new Error('Database handle required for persistent job queue');
    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO engineering_jobs (
        id, project_id, user_id, job_type, status, progress, current_step,
        checkpoint_data, logs_snippet, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', 0, 'initialized', ?, '', ?, ?)
    `);

    stmt.run(jobId, projectId, userId, jobType, JSON.stringify({ _initialPayload: payload }), now, now);

    return {
      jobId,
      projectId,
      jobType,
      status: 'queued',
      progress: 0,
      createdAt: now
    };
  }

  updateCheckpoint(jobId, stepName, progressPercent, data = {}) {
    if (!this.db) return false;
    const now = new Date().toISOString();
    const current = this.getJob(jobId);
    let checkpointData = {};
    try {
      checkpointData = JSON.parse(current?.checkpoint_data || '{}');
    } catch (_) {}

    checkpointData[stepName] = {
      completedAt: now,
      progress: progressPercent,
      data
    };

    const stmt = this.db.prepare(`
      UPDATE engineering_jobs
      SET current_step = ?, progress = ?, checkpoint_data = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(stepName, progressPercent, JSON.stringify(checkpointData), now, jobId);
    return true;
  }

  getJob(jobId) {
    if (!this.db) return null;
    return this.db.prepare('SELECT * FROM engineering_jobs WHERE id = ?').get(jobId);
  }

  resumeJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    let checkpoints = {};
    try {
      checkpoints = JSON.parse(job.checkpoint_data || '{}');
    } catch (_) {}

    const completedSteps = Object.keys(checkpoints).filter(k => checkpoints[k] && typeof checkpoints[k] === 'object' && checkpoints[k].completedAt);
    return {
      jobId,
      status: job.status,
      lastStep: job.current_step,
      progress: job.progress,
      completedSteps,
      resumedAt: new Date().toISOString(),
      canResume: job.status !== 'completed'
    };
  }

  completeJob(jobId, logs = '') {
    if (!this.db) return false;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE engineering_jobs
      SET status = 'completed', progress = 100, current_step = 'finished',
          logs_snippet = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(logs, now, now, jobId);
    return true;
  }

  failJob(jobId, errorMessage = '') {
    if (!this.db) return false;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE engineering_jobs
      SET status = 'failed', current_step = 'error',
          logs_snippet = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage, now, now, jobId);
    return true;
  }
}

module.exports = {
  BackgroundJobQueue
};

/**
 * agentRoutes.js
 * Phase 4: AI Executive Assistant & Dynamic UI REST Endpoints
 *
 * Exposes endpoints for agent dispatch, custom screens lifecycle, dynamic records,
 * and continuous learning feedback.
 */

const express = require('express');
const { getDb } = require('../db/database');
const agent = require('../services/agent/agentService');

const router = express.Router();

/**
 * POST /api/agent/dispatch
 * Main interaction endpoint for the AI Executive Agent.
 */
router.post('/dispatch', (req, res) => {
  try {
    const { prompt, userRole = 'business_owner', currentScreen = null, confirmed = false } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    const outcome = agent.dispatchPrompt({
      prompt,
      userRole,
      currentScreen,
      confirmed: Boolean(confirmed)
    });

    return res.json({
      success: outcome.valid,
      data: outcome.data,
      errors: outcome.errors,
      repaired: outcome.repaired
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agent/screens
 * Lists all active custom screens.
 */
router.get('/screens', (req, res) => {
  try {
    const db = getDb();
    const screens = agent.listCustomScreens(db, req.query.projectId, req.query.userId);
    return res.json({ success: true, count: screens.length, data: screens });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent/screens
 * Saves or updates a custom screen definition.
 */
router.post('/screens', (req, res) => {
  try {
    const db = getDb();
    const { projectId = 'default', userId = 'system', title, description = '', viewType = 'FORM', uiSchema = {}, mockRecords = [] } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const result = agent.saveCustomScreen(db, {
      projectId,
      userId,
      title,
      description,
      viewType,
      uiSchema,
      mockRecords
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agent/screens/:id
 * Retrieves a custom screen schema and its dynamic records.
 */
router.get('/screens/:id', (req, res) => {
  try {
    const db = getDb();
    const screen = agent.getCustomScreen(db, req.params.id);
    if (!screen) {
      return res.status(404).json({ success: false, error: 'Screen not found' });
    }
    return res.json({ success: true, data: screen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent/screens/:id/records
 * Inserts a new dynamic record submitted through the dynamic screen.
 */
router.post('/screens/:id/records', (req, res) => {
  try {
    const db = getDb();
    const record = agent.insertDynamicRecord(db, req.params.id, req.body.data || {}, req.body.userId || 'guest');
    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agent/screens/:id/records
 * Lists all dynamic records stored for a screen.
 */
router.get('/screens/:id/records', (req, res) => {
  try {
    const db = getDb();
    const screen = agent.getCustomScreen(db, req.params.id);
    if (!screen) {
      return res.status(404).json({ success: false, error: 'Screen not found' });
    }
    return res.json({ success: true, data: screen.dynamicRecords || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent/feedback
 * Records user rating (thumbs up / down) and prompt/response for few-shot learning.
 */
router.post('/feedback', (req, res) => {
  try {
    const db = getDb();
    const { userId = 'system', userRole = 'business_owner', prompt, response = {}, rating = 1, notes = '' } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    const saved = agent.saveAiFeedback(db, {
      userId,
      userRole,
      prompt,
      response,
      rating: Number(rating),
      notes
    });

    return res.status(201).json({ success: true, data: saved });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

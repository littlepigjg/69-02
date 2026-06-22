const express = require('express');
const router = express.Router();
const storage = require('./storage');
const status = require('./status');
const scheduler = require('./scheduler');
const notifier = require('./notifier');

router.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

router.get('/services', async (req, res) => {
  try {
    const services = await storage.services.getAll();
    const enriched = [];
    for (const svc of services) {
      enriched.push({
        ...svc,
        summary: await status.getServiceSummary(svc.id)
      });
    }
    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id', async (req, res) => {
  try {
    const svc = await storage.services.getById(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    res.json({
      ...svc,
      summary: await status.getServiceSummary(svc.id)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.name || !data.type || !data.target) {
      return res.status(400).json({ error: 'name, type, target are required' });
    }
    if (!['http', 'https', 'tcp'].includes(data.type)) {
      return res.status(400).json({ error: 'type must be http, https, or tcp' });
    }
    if (data.type === 'tcp' && !data.port && !data.target.includes(':')) {
      return res.status(400).json({ error: 'tcp type requires port' });
    }
    const created = await storage.services.create(data);
    if (created.enabled) {
      scheduler.startServiceCheck(created);
    }
    notifier.notifyServiceUpdate(created.id, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.services.getById(id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const data = req.body || {};
    const allowed = ['name', 'type', 'target', 'port', 'method', 'expectedStatus', 'interval_seconds', 'timeout_ms', 'enabled'];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }

    const updated = await storage.services.update(id, toUpdate);
    scheduler.restartServiceCheck(updated);
    notifier.notifyServiceUpdate(updated.id, updated);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await storage.services.getById(id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });
    scheduler.stopServiceCheck(id);
    await storage.services.remove(id);
    notifier.broadcast({ type: 'service_deleted', serviceId: id, timestamp: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/:id/check', async (req, res) => {
  try {
    const id = req.params.id;
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    scheduler.runCheck(svc);
    res.json({ ok: true, message: 'Check triggered' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/trend', async (req, res) => {
  try {
    const id = req.params.id;
    const hours = parseInt(req.query.hours, 10) || 24;
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const data = await status.getTrendData(id, hours);
    res.json({ serviceId: id, hours, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/results', async (req, res) => {
  try {
    const id = req.params.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const svc = await storage.services.getById(id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const results = await storage.checkResults.getLatest(id, limit);
    res.json({ serviceId: id, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/maintenance', async (req, res) => {
  try {
    res.json(await storage.maintenance.getAll());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/:id/maintenance', async (req, res) => {
  try {
    const id = req.params.id;
    res.json(await storage.maintenance.getAll(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance', async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.name || !data.start_time || !data.end_time) {
      return res.status(400).json({ error: 'name, start_time, end_time are required' });
    }
    const created = await storage.maintenance.create(data);
    notifier.notifyMaintenanceChange(data.service_id || null, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/maintenance/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body || {};
    const allowed = ['name', 'start_time', 'end_time', 'description', 'active', 'service_id'];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }
    const updated = await storage.maintenance.update(id, toUpdate);
    notifier.notifyMaintenanceChange(updated.service_id, updated);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/maintenance/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await storage.maintenance.remove(id);
    notifier.notifyMaintenanceChange(null, { id, deleted: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/maintenance/quick', async (req, res) => {
  try {
    const { service_id, minutes = 60, name, description } = req.body || {};
    if (!service_id) return res.status(400).json({ error: 'service_id is required' });
    const svc = await storage.services.getById(service_id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });

    const now = new Date();
    const end = new Date(now.getTime() + minutes * 60 * 1000);
    const data = {
      service_id,
      name: name || `临时维护 - ${svc.name}`,
      description: description || `手动设置的维护窗口，时长${minutes}分钟`,
      start_time: now.toISOString(),
      end_time: end.toISOString(),
      active: 1
    };
    const created = await storage.maintenance.create(data);
    notifier.notifyMaintenanceChange(service_id, created);
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/status/summary', async (req, res) => {
  try {
    const services = await storage.services.getAll();
    let up = 0, down = 0, maintenance = 0, unknown = 0;
    const summaries = [];
    for (const svc of services) {
      const s = await status.getServiceSummary(svc.id);
      if (s.status === 'up') up++;
      else if (s.status === 'down') down++;
      else if (s.status === 'maintenance') maintenance++;
      else unknown++;
      summaries.push({ serviceId: svc.id, name: svc.name, type: svc.type, ...s });
    }

    res.json({
      total: services.length,
      counts: { up, down, maintenance, unknown },
      services: summaries
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

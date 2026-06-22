const express = require('express');
const router = express.Router();
const storage = require('./storage');
const status = require('./status');
const scheduler = require('./scheduler');
const notifier = require('./notifier');
const alertManager = require('./alert-manager');
const alertTemplate = require('./alert-template');
const alertSenders = require('./alert-senders');
const { ALERT_TYPES, ALERT_CHANNELS, ALERT_LEVELS, TEMPLATE_VARIABLES } = require('./alert-constants');

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

router.get('/alerts/summary', async (req, res) => {
  try {
    const summary = await alertManager.getAlertSummary();
    res.json(summary);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/config', (req, res) => {
  try {
    const cfg = alertManager.getAlertConfig();
    res.json({
      enabled: cfg.enabled,
      defaultSilenceMinutes: cfg.defaultSilenceMinutes,
      defaultConsecutiveFailures: cfg.defaultConsecutiveFailures,
      defaultEscalationThreshold: cfg.defaultEscalationThreshold,
      recoveryLinkBaseUrl: cfg.recoveryLinkBaseUrl,
      channels: {
        email: { enabled: cfg.channels.email?.enabled || false, hasConfig: !!cfg.channels.email?.smtp?.host },
        wechat: { enabled: cfg.channels.wechat?.enabled || false, hasConfig: !!cfg.channels.wechat?.webhookUrl },
        dingtalk: { enabled: cfg.channels.dingtalk?.enabled || false, hasConfig: !!cfg.channels.dingtalk?.webhookUrl }
      },
      templates: cfg.templates,
      availableChannels: Object.values(ALERT_CHANNELS),
      availableAlertLevels: ALERT_LEVELS
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/config/reload', async (req, res) => {
  try {
    const cfg = alertManager.reloadConfig();
    res.json({ ok: true, config: cfg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/variables', (req, res) => {
  try {
    res.json({ variables: TEMPLATE_VARIABLES });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/template/validate', async (req, res) => {
  try {
    const { template, alertType, requiredVars = [] } = req.body || {};
    if (!template) {
      return res.status(400).json({ error: 'template is required' });
    }
    const result = alertTemplate.validateTemplate(template, requiredVars);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/template/render', async (req, res) => {
  try {
    const { template, alertType, variables } = req.body || {};
    if (!alertType) {
      return res.status(400).json({ error: 'alertType is required' });
    }
    const cfg = alertManager.getAlertConfig();
    if (template) {
      const tpl = typeof template === 'string' ? { title: template, content: template } : template;
      const title = alertTemplate.renderTemplate(tpl.title || '', variables || {});
      const content = alertTemplate.renderTemplate(tpl.content || '', variables || {});
      res.json({ title, content });
    } else {
      const rendered = alertTemplate.renderAlert(cfg.templates, alertType, variables || {});
      res.json(rendered);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/records', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const records = await storage.alertRecords.getAll(limit, offset);
    const parsed = records.map(r => ({
      ...r,
      channels: r.channels ? JSON.parse(r.channels) : [],
      sent_channels: r.sent_channels ? JSON.parse(r.sent_channels) : [],
      failed_channels: r.failed_channels ? JSON.parse(r.failed_channels) : []
    }));
    res.json({ total: parsed.length, limit, offset, records: parsed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/records/:id', async (req, res) => {
  try {
    const record = await storage.alertRecords.getById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Alert record not found' });
    const parsed = {
      ...record,
      channels: record.channels ? JSON.parse(record.channels) : [],
      sent_channels: record.sent_channels ? JSON.parse(record.sent_channels) : [],
      failed_channels: record.failed_channels ? JSON.parse(record.failed_channels) : []
    };
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/records/service/:serviceId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const records = await storage.alertRecords.getByService(req.params.serviceId, limit);
    const parsed = records.map(r => ({
      ...r,
      channels: r.channels ? JSON.parse(r.channels) : [],
      sent_channels: r.sent_channels ? JSON.parse(r.sent_channels) : [],
      failed_channels: r.failed_channels ? JSON.parse(r.failed_channels) : []
    }));
    res.json({ serviceId: req.params.serviceId, records: parsed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/stats', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const stats = await storage.alertRecords.getStats(days);
    res.json({ days, ...stats });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/states', async (req, res) => {
  try {
    const states = await storage.alertStates.getAll();
    res.json({ count: states.length, states });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/states/service/:serviceId', async (req, res) => {
  try {
    const state = await storage.alertStates.getByService(req.params.serviceId);
    if (!state) return res.status(404).json({ error: 'Alert state not found for service' });
    const effCfg = alertManager.getEffectiveConfig(req.params.serviceId);
    const inSilence = alertManager.isInSilence(state.silence_until);
    res.json({ state, effectiveConfig: effCfg, inSilence });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/service/:serviceId/silence', async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const minutes = parseInt(req.body?.minutes, 10);
    if (minutes === undefined || isNaN(minutes)) {
      return res.status(400).json({ error: 'minutes is required' });
    }
    const svc = await storage.services.getById(serviceId);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const state = await alertManager.setServiceSilence(serviceId, minutes);
    notifier.broadcast({
      type: 'alert_silence_updated',
      serviceId,
      silenceMinutes: minutes,
      silenceUntil: state?.silence_until,
      timestamp: new Date().toISOString()
    });
    res.json({ ok: true, serviceId, silenceMinutes: minutes, silenceUntil: state?.silence_until });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/alerts/config-overrides/service/:serviceId', async (req, res) => {
  try {
    const override = await storage.alertConfigOverrides.getByService(req.params.serviceId);
    res.json({ serviceId: req.params.serviceId, override: override || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/config-overrides/service/:serviceId', async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const svc = await storage.services.getById(serviceId);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const data = req.body || {};
    const allowed = [
      'silence_minutes', 'consecutive_failures', 'escalation_threshold',
      'escalation_level', 'enable_email', 'enable_wechat', 'enable_dingtalk',
      'custom_recipients_json'
    ];
    const toUpdate = {};
    for (const key of allowed) {
      if (key in data) toUpdate[key] = data[key];
    }
    const result = await storage.alertConfigOverrides.upsertByService(serviceId, toUpdate);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/alerts/config-overrides/:id', async (req, res) => {
  try {
    await storage.alertConfigOverrides.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/test', async (req, res) => {
  try {
    const { serviceId, channels, alertLevel, serviceName, errorMessage, failureCount } = req.body || {};
    const result = await alertManager.sendTestAlert(serviceId, {
      channels,
      alertLevel: alertLevel != null ? parseInt(alertLevel, 10) : ALERT_LEVELS.L0,
      serviceName,
      errorMessage,
      failureCount: failureCount != null ? parseInt(failureCount, 10) : 1
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/alerts/test/channel', async (req, res) => {
  try {
    const { channel, title, content, useEscalation = false, alertLevel = ALERT_LEVELS.L0 } = req.body || {};
    if (!channel) return res.status(400).json({ error: 'channel is required' });
    const cfg = alertManager.getAlertConfig();
    const testTitle = title || `【测试告警】${channel} 渠道测试`;
    const testContent = content || `这是一条通过 ${channel} 渠道发送的测试告警消息。\n发送时间：${new Date().toISOString()}\n如果收到此消息，说明 ${channel} 渠道配置正常。`;
    try {
      const result = await alertSenders.sendToChannel(channel, cfg, {
        title: testTitle,
        content: testContent,
        alertLevel: parseInt(alertLevel, 10),
        useEscalation: !!useEscalation
      });
      res.json({ success: true, channel, result });
    } catch (e) {
      res.status(400).json({ success: false, channel, error: e.message });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

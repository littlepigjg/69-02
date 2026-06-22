const axios = require('axios')
const crypto = require('crypto')
const { ALERT_CHANNELS, ALERT_LEVELS, WECHAT_MSG_TYPES, DINGTALK_MSG_TYPES } = require('./alert-constants')
const { escapeHtml, escapeMarkdown } = require('./alert-template')
const { getMergedRecipients } = require('./alert-decision')

let nodemailer = null
try {
  nodemailer = require('nodemailer')
} catch (e) {
  console.warn('[AlertSenders] nodemailer not installed, email channel will be disabled. Install with: npm install nodemailer')
}

const transporterCache = new Map()

function getEmailTransporter(smtpConfig) {
  const cacheKey = JSON.stringify(smtpConfig)
  if (transporterCache.has(cacheKey)) return transporterCache.get(cacheKey)
  if (!nodemailer) throw new Error('nodemailer not installed')
  const transporter = nodemailer.createTransport(smtpConfig)
  transporterCache.set(cacheKey, transporter)
  return transporter
}

async function sendEmail(config, { title, content, recipients, alertLevel = ALERT_LEVELS.L0 }) {
  if (!nodemailer) {
    throw new Error('nodemailer not installed, please run: npm install nodemailer')
  }
  const channelCfg = config?.channels?.email
  if (!channelCfg?.enabled) {
    throw new Error('Email channel is disabled')
  }
  const smtp = channelCfg.smtp
  if (!smtp?.host || !smtp?.auth?.user) {
    throw new Error('Email SMTP configuration is incomplete')
  }
  const transporter = getEmailTransporter(smtp)
  const toList = recipients?.length > 0 ? recipients : (channelCfg.recipients || [])
  if (toList.length === 0) {
    throw new Error('No email recipients configured')
  }
  const priorityLabels = { [ALERT_LEVELS.L0]: 'normal', [ALERT_LEVELS.L1]: 'normal', [ALERT_LEVELS.L2]: 'high', [ALERT_LEVELS.L3]: 'high' }
  const mailOptions = {
    from: channelCfg.from || smtp.auth.user,
    to: toList.join(', '),
    subject: title,
    priority: priorityLabels[alertLevel] || 'normal',
    text: content,
    html: content
      .split('\n')
      .map(line => escapeHtml(line))
      .join('<br/>')
  }
  await transporter.sendMail(mailOptions)
  return { success: true, channel: ALERT_CHANNELS.EMAIL, recipients: toList }
}

async function sendWechat(config, { title, content, alertLevel = ALERT_LEVELS.L0, useEscalation = false }) {
  const channelCfg = config?.channels?.wechat
  if (!channelCfg?.enabled) {
    throw new Error('WeChat channel is disabled')
  }
  let webhookUrl = useEscalation ? (channelCfg.escalationWebhookUrl || channelCfg.webhookUrl) : channelCfg.webhookUrl
  if (!webhookUrl) {
    throw new Error('WeChat webhook URL not configured')
  }
  const mentionedMobileList = useEscalation
    ? (channelCfg.escalationMentionedMobileList || channelCfg.mentionedMobileList || [])
    : (channelCfg.mentionedMobileList || [])
  const mentionedList = useEscalation
    ? (channelCfg.escalationMentionedList || channelCfg.mentionedList || [])
    : (channelCfg.mentionedList || [])
  const mdContent = `### ${title}\n\n${content}`
  const payload = {
    msgtype: WECHAT_MSG_TYPES.MARKDOWN,
    markdown: { content: mdContent }
  }
  if (mentionedMobileList.length > 0 || mentionedList.length > 0) {
    payload.markdown.mentioned_mobile_list = mentionedMobileList
    payload.markdown.mentioned_list = mentionedList
  }
  const resp = await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  })
  const data = resp.data
  if (data.errcode !== 0) {
    throw new Error(`WeChat webhook error: ${data.errcode} - ${data.errmsg || 'Unknown error'}`)
  }
  return { success: true, channel: ALERT_CHANNELS.WECHAT, webhookUrl, mentionedMobileList, mentionedList }
}

function generateDingtalkSign(secret) {
  if (!secret) return { timestamp: '', sign: '' }
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${secret}`
  const hmac = crypto.createHmac('sha256', secret)
  const data = hmac.update(Buffer.from(stringToSign, 'utf8'))
  const sign = encodeURIComponent(data.digest('base64'))
  return { timestamp, sign }
}

async function sendDingtalk(config, { title, content, alertLevel = ALERT_LEVELS.L0, useEscalation = false }) {
  const channelCfg = config?.channels?.dingtalk
  if (!channelCfg?.enabled) {
    throw new Error('DingTalk channel is disabled')
  }
  let webhookUrl = useEscalation ? (channelCfg.escalationWebhookUrl || channelCfg.webhookUrl) : channelCfg.webhookUrl
  if (!webhookUrl) {
    throw new Error('DingTalk webhook URL not configured')
  }
  const secret = useEscalation ? (channelCfg.escalationSecret || channelCfg.secret) : channelCfg.secret
  if (secret) {
    const { timestamp, sign } = generateDingtalkSign(secret)
    const separator = webhookUrl.includes('?') ? '&' : '?'
    webhookUrl = `${webhookUrl}${separator}timestamp=${timestamp}&sign=${sign}`
  }
  const atMobiles = useEscalation
    ? (channelCfg.escalationAtMobiles || channelCfg.atMobiles || [])
    : (channelCfg.atMobiles || [])
  const atUserIds = useEscalation
    ? (channelCfg.escalationAtUserIds || channelCfg.atUserIds || [])
    : (channelCfg.atUserIds || [])
  const isAtAll = useEscalation ? (channelCfg.escalationIsAtAll || false) : (channelCfg.isAtAll || false)
  const mdContent = `### ${title}\n\n${content}`
  const payload = {
    msgtype: DINGTALK_MSG_TYPES.MARKDOWN,
    markdown: { title: title.substring(0, 32), text: mdContent },
    at: {
      atMobiles,
      atUserIds,
      isAtAll
    }
  }
  const resp = await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  })
  const data = resp.data
  if (data.errcode !== 0) {
    throw new Error(`DingTalk webhook error: ${data.errcode} - ${data.errmsg || 'Unknown error'}`)
  }
  return { success: true, channel: ALERT_CHANNELS.DINGTALK, webhookUrl, atMobiles, atUserIds, isAtAll }
}

async function sendToChannel(channel, config, params) {
  switch (channel) {
    case ALERT_CHANNELS.EMAIL:
      return sendEmail(config, params)
    case ALERT_CHANNELS.WECHAT:
      return sendWechat(config, params)
    case ALERT_CHANNELS.DINGTALK:
      return sendDingtalk(config, params)
    default:
      throw new Error(`Unknown alert channel: ${channel}`)
  }
}

async function sendAll(channels, config, params) {
  if (!channels || channels.length === 0) {
    return { sent: [], failed: [], errors: ['No channels specified'] }
  }
  const sent = []
  const failed = []
  const errors = []
  for (const channel of channels) {
    try {
      const result = await sendToChannel(channel, config, params)
      sent.push(channel)
    } catch (e) {
      failed.push(channel)
      errors.push(`${channel}: ${e.message}`)
      console.error(`[AlertSenders] Failed to send via ${channel}:`, e.message)
    }
  }
  return { sent, failed, errors }
}

function getEnabledChannels(config, overrides = null) {
  const channels = []
  const emailCfg = config?.channels?.email
  const wechatCfg = config?.channels?.wechat
  const dingtalkCfg = config?.channels?.dingtalk
  const enableEmail = overrides?.enable_email != null ? !!overrides.enable_email : !!emailCfg?.enabled
  const enableWechat = overrides?.enable_wechat != null ? !!overrides.enable_wechat : !!wechatCfg?.enabled
  const enableDingtalk = overrides?.enable_dingtalk != null ? !!overrides.enable_dingtalk : !!dingtalkCfg?.enabled
  if (enableEmail) channels.push(ALERT_CHANNELS.EMAIL)
  if (enableWechat) channels.push(ALERT_CHANNELS.WECHAT)
  if (enableDingtalk) channels.push(ALERT_CHANNELS.DINGTALK)
  return channels
}

function getEscalationRecipients(config, alertLevel, isEscalation = false) {
  const result = {}
  const emailCfg = config?.channels?.email
  const defaultRecipients = emailCfg?.recipients || []
  const escalationRecipients = emailCfg?.escalationRecipients || []
  const effectiveLevel = isEscalation ? alertLevel : Math.max(0, alertLevel - 1)
  result.email = getMergedRecipients(defaultRecipients, escalationRecipients, effectiveLevel)
  return result
}

module.exports = {
  sendEmail,
  sendWechat,
  sendDingtalk,
  sendToChannel,
  sendAll,
  getEnabledChannels,
  getEscalationRecipients,
  generateDingtalkSign
}

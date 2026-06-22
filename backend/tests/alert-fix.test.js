const assert = require('assert')
const {
  shouldTriggerAlert,
  calculateAlertLevel,
  getMergedRecipients
} = require('../alert-decision')
const { getEscalationRecipients } = require('../alert-senders')
const { ALERT_LEVELS, ALERT_TYPES } = require('../alert-constants')

console.log('=== 告警系统修复验证测试 ===\n')

function runTest(name, fn) {
  try {
    fn()
    console.log(`✅ PASS: ${name}`)
  } catch (e) {
    console.log(`❌ FAIL: ${name}`)
    console.log(`   ${e.message}`)
    process.exitCode = 1
  }
}

const defaultEffCfg = {
  silenceMinutes: 30,
  consecutiveFailures: 3,
  escalationThreshold: 5,
  escalationLevel: 1,
  recoveryLinkBaseUrl: 'http://example.com',
  recoveryLinkPath: '/services'
}

console.log('--- 问题1: 静默期拦住升级告警 ---')

runTest('首次失败 < 阈值，不应发送', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 1,
    last_alert_time: null,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, false)
  assert.ok(result.reason.startsWith('failures_'))
})

runTest('首次达到阈值（3次失败），应该发送 L0 告警', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.alertType, ALERT_TYPES.DOWN)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L0)
  assert.strictEqual(result.isEscalation, false)
})

runTest('静默期内同级重复告警，应该被拦截', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 4,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, false)
  assert.ok(result.reason.startsWith('silence_'))
  assert.strictEqual(result.isEscalation, false)
})

runTest('达到升级阈值（5次失败），即使在静默期内也应该穿透并发送 L1 升级告警', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 5,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true, '升级告警应该穿透静默期')
  assert.strictEqual(result.alertType, ALERT_TYPES.ESCALATION)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L1)
  assert.strictEqual(result.isEscalation, true)
  assert.strictEqual(result.inIntervalSilence, true, '应该识别到处于间隔静默期但仍然允许穿透')
  assert.ok(result.note?.includes('升级告警穿透'))
})

runTest('再次升级（10次失败），即使在静默期内也应该发送 L2 告警', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 10,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 1,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true, '再次升级也应该穿透')
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L2)
  assert.strictEqual(result.isEscalation, true)
})

runTest('手动静默期内，升级告警也应该穿透', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 5,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    silence_until: oneHourLater
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true, '手动静默期内升级告警也应该穿透')
  assert.strictEqual(result.isEscalation, true)
  assert.strictEqual(result.inManualSilence, true)
  assert.ok(result.note?.includes('升级告警穿透手动静默期'))
})

runTest('手动静默期内，非升级告警应该被拦截', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 4,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    silence_until: oneHourLater
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, false)
  assert.strictEqual(result.reason, 'in_manual_silence')
  assert.strictEqual(result.isEscalation, false)
})

console.log('\n--- 告警级别计算 ---')

runTest('连续失败次数 < 阈值，级别为 L0', () => {
  assert.strictEqual(calculateAlertLevel(3, 5), ALERT_LEVELS.L0)
  assert.strictEqual(calculateAlertLevel(4, 5), ALERT_LEVELS.L0)
})

runTest('连续失败次数 = 阈值，级别升为 L1', () => {
  assert.strictEqual(calculateAlertLevel(5, 5), ALERT_LEVELS.L1)
  assert.strictEqual(calculateAlertLevel(6, 5), ALERT_LEVELS.L1)
  assert.strictEqual(calculateAlertLevel(9, 5), ALERT_LEVELS.L1)
})

runTest('连续失败次数 = 2倍阈值，级别升为 L2', () => {
  assert.strictEqual(calculateAlertLevel(10, 5), ALERT_LEVELS.L2)
  assert.strictEqual(calculateAlertLevel(14, 5), ALERT_LEVELS.L2)
})

runTest('连续失败次数 = 3倍阈值，级别升为 L3（封顶）', () => {
  assert.strictEqual(calculateAlertLevel(15, 5), ALERT_LEVELS.L3)
  assert.strictEqual(calculateAlertLevel(100, 5), ALERT_LEVELS.L3)
})

console.log('\n--- 问题2: 升级告警收件人未生效 ---')

runTest('getMergedRecipients: L0 不添加升级收件人', () => {
  const defaultRecipients = ['ops@example.com']
  const escalationRecipients = ['manager@example.com', 'director@example.com']
  const result = getMergedRecipients(defaultRecipients, escalationRecipients, ALERT_LEVELS.L0)
  assert.deepStrictEqual(result, ['ops@example.com'])
})

runTest('getMergedRecipients: L1 添加第一个升级收件人', () => {
  const defaultRecipients = ['ops@example.com']
  const escalationRecipients = ['manager@example.com', 'director@example.com']
  const result = getMergedRecipients(defaultRecipients, escalationRecipients, ALERT_LEVELS.L1)
  assert.deepStrictEqual(result, ['ops@example.com', 'manager@example.com'])
})

runTest('getMergedRecipients: L2 添加前两个升级收件人', () => {
  const defaultRecipients = ['ops@example.com']
  const escalationRecipients = ['manager@example.com', 'director@example.com']
  const result = getMergedRecipients(defaultRecipients, escalationRecipients, ALERT_LEVELS.L2)
  assert.deepStrictEqual(result, ['ops@example.com', 'manager@example.com', 'director@example.com'])
})

runTest('getMergedRecipients: 即使没有升级收件人也返回默认收件人', () => {
  const defaultRecipients = ['ops@example.com']
  const result = getMergedRecipients(defaultRecipients, [], ALERT_LEVELS.L2)
  assert.deepStrictEqual(result, ['ops@example.com'])
})

runTest('getEscalationRecipients: 非升级时 L1 只加 0 个（降级逻辑）', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L1, false)
  assert.deepStrictEqual(result.email, ['ops@example.com'])
})

runTest('getEscalationRecipients: 升级时 L1 添加 1 个升级收件人', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L1, true)
  assert.deepStrictEqual(result.email, ['ops@example.com', 'manager@example.com'])
})

runTest('getEscalationRecipients: 升级时 L2 添加 2 个升级收件人', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, ['ops@example.com', 'manager@example.com', 'director@example.com'])
})

runTest('getEscalationRecipients: 没有 escalationRecipients 时也返回默认收件人（修复前的 bug）', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, ['ops@example.com'], '修复前这里会返回 undefined')
})

runTest('getEscalationRecipients: 完全没有配置也返回空数组', () => {
  const config = {
    channels: {
      email: {}
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, [])
})

console.log('\n--- 静默期过期后正常发送 ---')

runTest('静默期过期后，同级告警可以正常发送', () => {
  const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 4,
    last_alert_time: thirtyFiveMinutesAgo,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, false)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L0)
})

console.log('\n=== 所有测试完成 ===')
if (process.exitCode === 1) {
  console.log('\n❌ 部分测试失败，请检查修复！')
} else {
  console.log('✅ 所有测试通过，修复验证成功！')
}

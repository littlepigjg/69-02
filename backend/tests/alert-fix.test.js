const assert = require('assert')
const {
  shouldTriggerAlert,
  calculateAlertLevel,
  getMergedRecipients
} = require('../alert-decision')
const { getEscalationRecipients } = require('../alert-senders')
const { ALERT_LEVELS, ALERT_TYPES } = require('../alert-constants')

console.log('=== 告警系统修复验证测试（第二轮） ===\n')

let failed = false

function runTest(name, fn) {
  try {
    fn()
    console.log(`✅ PASS: ${name}`)
  } catch (e) {
    console.log(`❌ FAIL: ${name}`)
    console.log(`   ${e.message}`)
    failed = true
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

// ============================================
// 问题1修复验证：告警级别状态更新
// ============================================
console.log('--- 问题1: 告警级别状态未及时更新 ---')

runTest('首次发送L0告警后，状态级别更新为L0，下一次失败未达阈值不升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    silence_until: null
  }
  const result1 = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result1.shouldSend, true, '首次应该发送')
  assert.strictEqual(result1.alertLevel, ALERT_LEVELS.L0)
  assert.strictEqual(result1.isEscalation, false)

  const updatedState = {
    ...state,
    consecutive_failures: 4,
    last_alert_time: new Date().toISOString(),
    last_alert_level: result1.alertLevel
  }
  const result2 = shouldTriggerAlert(updatedState, defaultEffCfg)
  assert.strictEqual(result2.shouldSend, false, '未达升级阈值且在静默期内，不应发送')
  assert.strictEqual(result2.isEscalation, false, '级别未提升，不是升级')
})

runTest('首次发送L0告警后，达到升级阈值时正确识别为升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    silence_until: null
  }
  const result1 = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result1.alertLevel, ALERT_LEVELS.L0)

  const updatedState = {
    ...state,
    consecutive_failures: 5,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: result1.alertLevel
  }
  const result2 = shouldTriggerAlert(updatedState, defaultEffCfg)
  assert.strictEqual(result2.shouldSend, true, '达到升级阈值应该发送')
  assert.strictEqual(result2.isEscalation, true, '应该识别为升级')
  assert.strictEqual(result2.alertLevel, ALERT_LEVELS.L1)
  assert.strictEqual(result2.alertType, ALERT_TYPES.ESCALATION)
})

runTest('发送L1升级告警后，状态更新为L1，下一次未达下一级不升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 5,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 0,
    silence_until: null
  }
  const result1 = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result1.isEscalation, true)
  assert.strictEqual(result1.alertLevel, ALERT_LEVELS.L1)

  const updatedState = {
    ...state,
    consecutive_failures: 7,
    last_alert_time: new Date().toISOString(),
    last_alert_level: result1.alertLevel
  }
  const result2 = shouldTriggerAlert(updatedState, defaultEffCfg)
  assert.strictEqual(result2.isEscalation, false, '级别未提升，不是升级')
  assert.strictEqual(result2.alertLevel, ALERT_LEVELS.L1)
})

runTest('发送L1告警后，达到L2阈值时正确识别为二次升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 7,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 1,
    silence_until: null
  }
  const result = shouldTriggerAlert({ ...state, consecutive_failures: 10 }, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, true, 'L1→L2应该识别为升级')
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L2)
})

runTest('级别封顶后不再升级（L3之后不再升）', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 15,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 3,
    silence_until: null
  }
  const result = shouldTriggerAlert({ ...state, consecutive_failures: 100 }, defaultEffCfg)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L3, 'L3封顶')
  assert.strictEqual(result.isEscalation, false, '已达最高级别，不再升级')
})

// ============================================
// 问题2修复验证：升级告警收件人策略
// ============================================
console.log('\n--- 问题2: 升级告警只发给高层，不包含默认收件人 ---')

runTest('普通告警（非升级）：只发给默认收件人，级别再高也不加高层', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, false)
  assert.deepStrictEqual(result.email, ['ops@example.com'], '普通告警只发给默认收件人')
})

runTest('升级告警 L1：只发给第1个高层，不包含默认收件人', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L1, true)
  assert.deepStrictEqual(result.email, ['manager@example.com'], 'L1升级只发给第一个高层')
  assert.ok(!result.email.includes('ops@example.com'), '升级告警不应包含默认收件人')
})

runTest('升级告警 L2：只发给前2个高层，不包含默认收件人', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, ['manager@example.com', 'director@example.com'], 'L2升级发给前两个高层')
  assert.ok(!result.email.includes('ops@example.com'), '升级告警不应包含默认收件人')
})

runTest('升级告警 L3：高层不足时只取可用的', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com', 'director@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L3, true)
  assert.deepStrictEqual(result.email, ['manager@example.com', 'director@example.com'], '高层只有2个，L3也只发2个')
})

runTest('没有配置escalationRecipients时，升级告警收件人为空', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, [], '没有高层配置时，升级告警收件人为空')
})

runTest('完全没有配置也返回空数组', () => {
  const config = {
    channels: {
      email: {}
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L2, true)
  assert.deepStrictEqual(result.email, [])
})

runTest('普通告警 L0：只发给默认收件人', () => {
  const config = {
    channels: {
      email: {
        recipients: ['ops@example.com'],
        escalationRecipients: ['manager@example.com']
      }
    }
  }
  const result = getEscalationRecipients(config, ALERT_LEVELS.L0, false)
  assert.deepStrictEqual(result.email, ['ops@example.com'])
})

// ============================================
// 回归测试：静默期穿透
// ============================================
console.log('\n--- 回归测试: 静默期穿透升级告警 ---')

runTest('静默期内，L0→L1升级应该穿透', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 5,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, true)
  assert.strictEqual(result.alertType, ALERT_TYPES.ESCALATION)
  assert.strictEqual(result.inIntervalSilence, true)
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
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, true)
  assert.strictEqual(result.inManualSilence, true)
})

// ============================================
// 级别计算回归测试
// ============================================
console.log('\n--- 回归测试: 告警级别计算 ---')

runTest('连续失败次数 < 阈值，级别为 L0', () => {
  assert.strictEqual(calculateAlertLevel(3, 5), ALERT_LEVELS.L0)
  assert.strictEqual(calculateAlertLevel(4, 5), ALERT_LEVELS.L0)
})

runTest('连续失败次数 = 阈值，级别升为 L1', () => {
  assert.strictEqual(calculateAlertLevel(5, 5), ALERT_LEVELS.L1)
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

// ============================================
// getMergedRecipients 回归测试（保持向后兼容）
// ============================================
console.log('\n--- 回归测试: getMergedRecipients 工具函数 ---')

runTest('getMergedRecipients: L0 不添加升级收件人', () => {
  const result = getMergedRecipients(['ops@x.com'], ['mgr@x.com'], ALERT_LEVELS.L0)
  assert.deepStrictEqual(result, ['ops@x.com'])
})

runTest('getMergedRecipients: L1 添加第一个升级收件人', () => {
  const result = getMergedRecipients(['ops@x.com'], ['mgr@x.com', 'dir@x.com'], ALERT_LEVELS.L1)
  assert.deepStrictEqual(result, ['ops@x.com', 'mgr@x.com'])
})

runTest('getMergedRecipients: 没有升级收件人时返回默认', () => {
  const result = getMergedRecipients(['ops@x.com'], [], ALERT_LEVELS.L2)
  assert.deepStrictEqual(result, ['ops@x.com'])
})

console.log('\n=== 所有测试完成 ===')
if (failed) {
  console.log('\n❌ 部分测试失败，请检查修复！')
  process.exit(1)
} else {
  console.log('✅ 所有测试通过，修复验证成功！')
}

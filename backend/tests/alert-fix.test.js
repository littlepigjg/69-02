const assert = require('assert')
const {
  shouldTriggerAlert,
  calculateAlertLevel,
  getMergedRecipients
} = require('../alert-decision')
const { getEscalationRecipients } = require('../alert-senders')
const { ALERT_LEVELS, ALERT_TYPES } = require('../alert-constants')

console.log('=== 告警系统修复验证测试（第三轮） ===\n')

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
// 问题1修复验证：current_alert_level 持续更新
// ============================================
console.log('--- 问题1: current_alert_level 未持续更新导致升级判断错误 ---')

runTest('首次发送L0告警后，current_alert_level=L0，下一次未达阈值不升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    current_alert_level: 0,
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
    last_alert_level: result1.alertLevel,
    current_alert_level: result1.alertLevel
  }
  const result2 = shouldTriggerAlert(updatedState, defaultEffCfg)
  assert.strictEqual(result2.shouldSend, false, '未达升级阈值且在静默期内，不应发送')
  assert.strictEqual(result2.isEscalation, false, '级别未提升，不是升级')
})

runTest('静默期拦截但current_alert_level更新后，达到升级阈值时正确识别升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    current_alert_level: 0,
    silence_until: null
  }
  const result1 = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result1.alertLevel, ALERT_LEVELS.L0)

  const updatedState = {
    ...state,
    consecutive_failures: 5,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: result1.alertLevel,
    current_alert_level: result1.alertLevel
  }
  const result2 = shouldTriggerAlert(updatedState, defaultEffCfg)
  assert.strictEqual(result2.shouldSend, true, '达到升级阈值应该发送')
  assert.strictEqual(result2.isEscalation, true, '应该识别为升级')
  assert.strictEqual(result2.alertLevel, ALERT_LEVELS.L1)
})

runTest('静默期连续拦截期间 current_alert_level 保持更新，最终升级基准正确', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 3,
    last_alert_time: null,
    last_alert_level: 0,
    current_alert_level: 0,
    silence_until: null
  }
  shouldTriggerAlert(state, defaultEffCfg)

  const stateAfterL0 = {
    ...state,
    consecutive_failures: 4,
    last_alert_time: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    last_alert_level: 0,
    current_alert_level: 0
  }
  const r = shouldTriggerAlert(stateAfterL0, defaultEffCfg)
  assert.strictEqual(r.alertLevel, ALERT_LEVELS.L0, '4次失败当前级别为L0')

  const stateAfterL0Updated = {
    ...stateAfterL0,
    consecutive_failures: 5,
    current_alert_level: ALERT_LEVELS.L0
  }
  const result2 = shouldTriggerAlert(stateAfterL0Updated, defaultEffCfg)
  assert.strictEqual(result2.isEscalation, true, 'L0→L1升级识别正确')
  assert.strictEqual(result2.alertLevel, ALERT_LEVELS.L1)
})

runTest('current_alert_level 已经是 L1，再次检查（静默期拦截）不重复升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 7,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 0,
    current_alert_level: ALERT_LEVELS.L1,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L1)
  assert.strictEqual(result.isEscalation, false, 'current_alert_level已经是L1，不应重复升级')
})

runTest('current_alert_level=L1，达到10次失败时正确识别L1→L2升级', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 10,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 0,
    current_alert_level: ALERT_LEVELS.L1,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true, '达到L2阈值，静默期内也应该穿透')
  assert.strictEqual(result.isEscalation, true, 'L1→L2应该识别为升级')
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L2)
})

runTest('级别封顶后不再升级（current_alert_level=L3不再升级）', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 100,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 3,
    current_alert_level: ALERT_LEVELS.L3,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L3, 'L3封顶')
  assert.strictEqual(result.isEscalation, false, '已达最高级别，不再升级')
})

runTest('没有 current_alert_level 字段时，回退到 last_alert_level 作为基准', () => {
  const state = {
    current_status: 'down',
    consecutive_failures: 7,
    last_alert_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    last_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L1)
  assert.strictEqual(result.isEscalation, true, '回退到last_alert_level=0，应识别为升级')
})

// ============================================
// 问题2修复验证：升级告警只发给高层
// ============================================
console.log('\n--- 问题2: 升级告警只发给高层，不包含默认收件人 ---')

runTest('普通告警（非升级）：只发给默认收件人', () => {
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
  assert.deepStrictEqual(result.email, ['manager@example.com', 'director@example.com'])
  assert.ok(!result.email.includes('ops@example.com'))
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
  assert.deepStrictEqual(result.email, ['manager@example.com', 'director@example.com'])
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
  const config = { channels: { email: {} } }
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
// getMergedRecipients：工具函数（独立语义，与升级策略无关）
// ============================================
console.log('\n--- getMergedRecipients 工具函数（用于普通告警等需要合并的场景） ---')

runTest('getMergedRecipients: L0 只返回默认收件人', () => {
  const result = getMergedRecipients(['ops@x.com'], ['mgr@x.com'], ALERT_LEVELS.L0)
  assert.deepStrictEqual(result, ['ops@x.com'])
})

runTest('getMergedRecipients: L1 合并默认+1个高层', () => {
  const result = getMergedRecipients(['ops@x.com'], ['mgr@x.com', 'dir@x.com'], ALERT_LEVELS.L1)
  assert.deepStrictEqual(result, ['ops@x.com', 'mgr@x.com'])
})

runTest('getMergedRecipients: L2 合并默认+2个高层', () => {
  const result = getMergedRecipients(['ops@x.com'], ['mgr@x.com', 'dir@x.com'], ALERT_LEVELS.L2)
  assert.deepStrictEqual(result, ['ops@x.com', 'mgr@x.com', 'dir@x.com'])
})

runTest('getMergedRecipients: 无高层配置时返回默认收件人', () => {
  const result = getMergedRecipients(['ops@x.com'], [], ALERT_LEVELS.L2)
  assert.deepStrictEqual(result, ['ops@x.com'])
})

// ============================================
// 回归测试：静默期穿透
// ============================================
console.log('\n--- 回归测试: 静默期穿透升级告警 ---')

runTest('间隔静默期内，L0→L1升级应该穿透', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 5,
    last_alert_time: fiveMinutesAgo,
    last_alert_level: 0,
    current_alert_level: 0,
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
    current_alert_level: 0,
    silence_until: oneHourLater
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, true)
  assert.strictEqual(result.inManualSilence, true)
})

runTest('静默期过期后，同级告警可以正常发送', () => {
  const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()
  const state = {
    current_status: 'down',
    consecutive_failures: 4,
    last_alert_time: thirtyFiveMinutesAgo,
    last_alert_level: 0,
    current_alert_level: 0,
    silence_until: null
  }
  const result = shouldTriggerAlert(state, defaultEffCfg)
  assert.strictEqual(result.shouldSend, true)
  assert.strictEqual(result.isEscalation, false)
  assert.strictEqual(result.alertLevel, ALERT_LEVELS.L0)
})

// ============================================
// 回归测试：级别计算
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

console.log('\n=== 所有测试完成 ===')
if (failed) {
  console.log('\n❌ 部分测试失败，请检查修复！')
  process.exit(1)
} else {
  console.log('✅ 所有测试通过，修复验证成功！')
}

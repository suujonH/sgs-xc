import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const defaultBackupDir = path.join(
  projectRoot,
  "work",
  "backups",
  "devBrowserTools-scripts-20260709-024831",
  "work"
);

const backupDir = process.env.SGS_OLD_SCRIPT_DIR || defaultBackupDir;
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_OLD_SCRIPT_REPORT_DIR ||
      path.join(explorationRoot, `${timestampName()}-old-script-map`)
  );
}

function trimLine(line) {
  return line.trim().replace(/\s+/g, " ");
}

function escapeMd(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function regexFrom(pattern) {
  return pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
}

const patternGroups = {
  sceneLifecycle: [
    /effectiveVisible/,
    /findTableGameScene/,
    /RogueSmallMapScene/,
    /TableGameScene/,
    /GameResultWindow/,
    /isGameOver/,
    /removeOverlay/,
    /ensureOverlay/,
    /setInterval/,
    /requestAnimationFrame/,
    /Laya\.stage/,
    /windowLayer/,
    /mWt/
  ],
  overlayUi: [
    /createElement/,
    /appendChild/,
    /pointerEvents/,
    /codex-sgs/,
    /ensureOverlay/,
    /removeOverlay/,
    /sidebar/,
    /cellContainer/,
    /overlay/
  ],
  rogue: [
    /RogueSmallMapScene/,
    /PveMgr/,
    /ChapterData/,
    /locations/,
    /cityView/,
    /GetCityItemById/,
    /GetCityAwardTypes/,
    /OnClickCity/,
    /RogueJiShiWindow/,
    /ShopData/,
    /RogueLikeDataReq/,
    /shopBtnClick/
  ],
  knownCards: [
    /knownTracker/,
    /publicPools/,
    /manager\.seats/,
    /selfSeatIndex/,
    /handCards/,
    /watchCards/,
    /handShowCards/,
    /logEntry/,
    /public:general/,
    /pWt/,
    /codexSgsKnownCardOverlay/,
    /codex-sgs-known-card-overlay/
  ],
  kanshu: [
    /KanShu/,
    /jbp/,
    /FreeBlessItemEnough/,
    /onKanShuClick/,
    /autoClickAllPeach/,
    /trueReqJbpAwd/,
    /buyPorpItem/,
    /gotoPay/
  ],
  autoActions: [
    /auto/i,
    /autoSelect/,
    /sendAutoChooseMoveOpt/,
    /confirmClick/,
    /startbtnClick/,
    /onKanShuClick/,
    /autoClickAllPeach/,
    /trueReqJbpAwd/,
    /shopBtnClick/,
    /OnClickCity/,
    /Close\(/,
    /removeSelf/,
    /\.click\(/,
    /send/i
  ],
  selectDiscardSkill: [
    /SkillSelector/,
    /SelectCard/,
    /SpellMultiSelector/,
    /discard/i,
    /弃/,
    /丢/,
    /choose/i,
    /MoveOpt/,
    /sendAutoChooseMoveOpt/,
    /autoSelect/
  ],
  shenZhugeGeneral: [
    /神/,
    /诸葛/,
    /qixing/i,
    /七星/,
    /星/,
    /public:general/,
    /武将牌上/,
    /general/
  ],
  effects: [
    /Effect/,
    /effect/,
    /Animation/,
    /Tween/,
    /Spine/,
    /show.*Effect/i,
    /hide.*Effect/i,
    /block/i,
    /mask/i,
    /alpha/,
    /visible/
  ],
  purchaseRisk: [
    /confirmBuy/,
    /buyPorpItem/,
    /gotoPay/,
    /OpenPay/,
    /ITt\.I\(\)\.O/,
    /refreshBtnClick/,
    /Buy/,
    /buy/,
    /Pay/,
    /pay/,
    /YuanBao/,
    /元宝/,
    /recharge/i
  ],
  networkMonitor: [
    /WebSocket/,
    /webSocketFrame/,
    /Network\./,
    /fetch/,
    /XMLHttpRequest/,
    /consoleAPICalled/,
    /Runtime\.evaluate/,
    /CDP/
  ]
};

const behaviorDefinitions = [
  {
    id: "rogue-reward-overlay",
    title: "山河图奖励辅助 UI",
    files: [/install-rogue-reward-overlay\.mjs/, /inspect-city-texture-size\.mjs/],
    groups: ["rogue", "overlayUi", "sceneLifecycle"],
    priorityPatterns: [
      /findSmallMapScene/,
      /RogueSmallMapScene/,
      /GetCityAwardTypes/,
      /GetCityItemById/,
      /localToGlobal/,
      /getSelfBounds/,
      /graphics/,
      /pointerEvents/,
      /removeOverlay/,
      /setInterval/
    ],
    monitoring:
      "CDP 注入后遍历 Laya.stage，寻找 effectiveVisible 的 RogueSmallMapScene；读取 scene.PveMgr、ChapterData.locations、cityView.GetCityItemById，并用 Laya 坐标换算到 canvas/DOM。",
    trigger:
      "脚本周期性 render；仅在可见 RogueSmallMapScene 存在时绘制，场景不存在、canvas 不存在或节点不可见时 removeOverlay。",
    action:
      "DOM overlay 只描画奖励文字/标签，pointer-events none，不调用购买或移动。",
    risk:
      "低风险显示层；主要风险是坐标漂移，因此需要 graphics bounds/localToGlobal，而不是固定坐标。"
  },
  {
    id: "known-card-overlay",
    title: "记牌器自动 UI",
    files: [/install-known-card-overlay\.mjs/, /verify-known-card-overlay\.mjs/],
    groups: ["knownCards", "overlayUi", "sceneLifecycle", "shenZhugeGeneral"],
    priorityPatterns: [
      /findTableGameScene/,
      /TableGameScene/,
      /manager\.seats/,
      /selfSeatIndex/,
      /handCards/,
      /public:general/,
      /武将牌上/,
      /publicPools/,
      /pointerEvents/,
      /removeOverlay/,
      /render/,
      /setInterval/
    ],
    monitoring:
      "CDP 注入后找 effectiveVisible 的 TableGameScene，读取 manager.seats、自身手牌、公开区、日志和 pWt 头像节点；不读取隐藏对手 handCards。",
    trigger:
      "TableGameScene 可见时 render；TableGameScene 不可见、没有 seats、游戏结果/离场状态或渲染失败时清理 overlay/状态。",
    action:
      "DOM overlay 描画已知牌、公开装备/判定/武将牌、弃牌区和来源标签；pointer-events none。",
    risk:
      "必须坚持已知来源边界，隐藏对手手牌只能作为未知数量，不能当成已知牌。"
  },
  {
    id: "rogue-shop-probe",
    title: "山河图商店打开/读取",
    files: [
      /hidden-open-shop-probe\.mjs/,
      /hooked-hidden-shop-probe\.mjs/,
      /probe-shop-now\.mjs/,
      /probe-shop-manager-data\.mjs/,
      /probe-shop-manager-details\.mjs/,
      /close-rogue-shop-window\.mjs/,
      /source-snippets\.mjs/,
      /rki-snippet\.mjs/
    ],
    groups: ["rogue", "autoActions", "purchaseRisk", "sceneLifecycle"],
    priorityPatterns: [
      /shopBtnClick/,
      /RogueJiShiWindow/,
      /ShopData/,
      /RogueLikeDataReq/,
      /refreshBtnClick/,
      /buy/,
      /confirmBuy/,
      /Close/,
      /removeSelf/,
      /ROGUELIKE_SHOP_SHOW/
    ],
    monitoring:
      "遍历 Laya.stage 找 RogueSmallMapScene 和带 shopBtnClick 的实例；可直接读 PveMgr.ShopData，必要时调用 RogueLikeDataReq(16) 同步商店数据。",
    trigger:
      "旧脚本用 shop.shopBtnClick() 打开 RogueJiShiWindow，再检查 WindowLayer/modalBg 和窗口节点。",
    action:
      "只允许打开/读取/关闭窗口；关闭用 Close/removeSelf，并恢复 localStorage 的 ROGUELIKE_SHOP_SHOW。",
    risk:
      "购买/刷新是风险动作：RogueJiShiWindow.refreshBtnClick、buy/confirmBuy 等必须被 guard 或不调用。"
  },
  {
    id: "kanshu-claim",
    title: "发财树/看树自动流程",
    files: [/auto-kanshu-claim\.mjs/, /install-kanshu-recorder\.mjs/, /read-kanshu-recorder-log\.mjs/],
    groups: ["kanshu", "autoActions", "purchaseRisk", "overlayUi", "sceneLifecycle"],
    priorityPatterns: [
      /findKanShuWindow/,
      /createHiddenKanShuWindow/,
      /cleanupHiddenKanShuWindow/,
      /jbpUserData/,
      /jbpawardVo/,
      /FreeBlessItemEnough/,
      /onKanShuClick/,
      /autoClickAllPeach/,
      /trueReqJbpAwd/,
      /buyPorpItem/,
      /gotoPay/,
      /OpenPay/
    ],
    monitoring:
      "找 KanShuWindow/wXi 或通过游戏窗口系统创建隐藏实例，读取 jbpUserData、jbpawardVo、FreeBlessItemEnough。",
    trigger:
      "窗口存在并状态允许时，按 onKanShuClick -> autoClickAllPeach -> trueReqJbpAwd 的实例方法链推进。",
    action:
      "自动展开桃子奖励并在免费分支请求奖励；记录器可抓取状态和方法调用。",
    risk:
      "非免费分支会进支付/充值确认，旧脚本已有 buyPorpItem/gotoPay/ITt.I().O/EKt.OpenPay guard；默认必须停止。"
  },
  {
    id: "skill-rule-audit",
    title: "技能规则/牌移动审计",
    files: [/extract-skill-catalog\.mjs/, /build-skill-rule-audit\.mjs/],
    groups: ["selectDiscardSkill", "knownCards", "autoActions"],
    priorityPatterns: [
      /discardExactOnly/,
      /maintainExactDiscardSubset/,
      /draw/i,
      /deck/i,
      /source/,
      /target/,
      /action/,
      /tags/
    ],
    monitoring:
      "从技能目录和旧规则里抽取 action、source、target、exact/unknown 移动语义，作为记牌器规则候选，不直接执行游戏动作。",
    trigger:
      "离线报告型脚本；由配置/旧规则输入触发。",
    action:
      "生成技能规则审计、候选分类和待验证点。",
    risk:
      "不能把旧规则猜测直接当事实；涉及牌序/来源/目标的规则需要 TableGameScene 日志/协议验证。"
  },
  {
    id: "ui-source-search",
    title: "UI 关键词/源码片段查找",
    files: [/find-ui-keyword\.mjs/, /find-source-snippets\.mjs/, /read-current-ui-summary\.mjs/],
    groups: ["sceneLifecycle", "overlayUi", "rogue", "autoActions"],
    priorityPatterns: [
      /effectiveVisible/,
      /visibleWindows/,
      /skin/,
      /text/,
      /methods/,
      /Laya\.stage/,
      /Runtime\.evaluate/
    ],
    monitoring:
      "遍历当前 Laya.stage 可见节点，采集 name/className/sceneName/skin/文本/方法名；或在解包源码中查找关键词。",
    trigger:
      "人工运行的探针；用来定位按钮、窗口、皮肤和方法入口。",
    action:
      "不改游戏状态，主要保存候选节点和源码证据。",
    risk:
      "DOM 文本不能代表游戏 UI；必须回到 Laya 节点和方法路径确认。"
  },
  {
    id: "resource-probe",
    title: "失败资源/资源替换线索",
    files: [/probe-failed-web-resources\.mjs/],
    groups: ["networkMonitor"],
    priorityPatterns: [
      /fetch/,
      /Runtime\.evaluate/,
      /entry/,
      /resource/,
      /failed/i,
      /CORS/i
    ],
    monitoring:
      "检查页面网络/资源加载失败信息，为资源描画/替换确认路径和 CORS 问题。",
    trigger:
      "人工运行资源探针。",
    action:
      "只读记录失败 URL/资源状态。",
    risk:
      "资源替换应通过 Laya URL hook 或本地 CORS 服务，不能依赖 file://。"
  },
  {
    id: "network-capture",
    title: "网络/协议捕获",
    files: [/capture-sgs-network\.mjs/],
    groups: ["networkMonitor", "knownCards"],
    priorityPatterns: [
      /Network\.enable/,
      /webSocket/,
      /Runtime\.enable/,
      /frame/,
      /message/,
      /capture/
    ],
    monitoring:
      "Chrome CDP Network/Runtime 事件；用于保存 WebSocket/protocol 证据，辅助记牌器和动作触发验证。",
    trigger:
      "手动启动监听，进入游戏流程后捕获。",
    action:
      "只记录，不主动点击或发包。",
    risk:
      "协议事实仍需和 Laya scene/log 对齐，避免把旧会话包当当前状态。"
  }
];

function roleForFile(name) {
  if (/known-card-overlay/i.test(name)) return "known-card-overlay";
  if (/rogue-reward-overlay/i.test(name)) return "rogue-reward-overlay";
  if (/shop/i.test(name)) return "rogue-shop";
  if (/kanshu/i.test(name)) return "kanshu";
  if (/skill/i.test(name)) return "skill-rule";
  if (/network/i.test(name)) return "network-capture";
  if (/resource/i.test(name)) return "resource-probe";
  if (/ui|summary|snippet/i.test(name)) return "ui-source-probe";
  return "misc-probe";
}

function collectMatches(lines, patterns, limit = 40) {
  const regexes = patterns.map(regexFrom);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const matched = regexes.filter((regex) => regex.test(line)).map((regex) => String(regex));
    if (matched.length) {
      out.push({ lineNumber: i + 1, line: trimLine(line), matched: matched.slice(0, 5) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function collectPriorityMatches(lines, priorityPatterns, fallbackPatterns, limit = 14) {
  const priority = (priorityPatterns || []).map(regexFrom);
  const fallback = (fallbackPatterns || []).map(regexFrom);
  const seen = new Set();
  const out = [];
  const scan = (patterns, maxPerPattern) => {
    for (const regex of patterns) {
      let addedForPattern = 0;
      for (let i = 0; i < lines.length; i += 1) {
        if (!regex.test(lines[i])) continue;
        const key = i + 1;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ lineNumber: i + 1, line: trimLine(lines[i]), matched: [String(regex)] });
        addedForPattern += 1;
        if (out.length >= limit || addedForPattern >= maxPerPattern) break;
      }
      if (out.length >= limit) break;
    }
  };
  scan(priority, 2);
  if (out.length < Math.min(8, limit)) scan(fallback, 1);
  return out.sort((a, b) => a.lineNumber - b.lineNumber).slice(0, limit);
}

function collectBehaviorMatches(fileRecords, behavior, limitPerFile = 12) {
  const groupPatterns = behavior.groups.flatMap((group) => patternGroups[group] || []);
  const ownPatterns = behavior.files || [];
  const rows = [];
  for (const record of fileRecords) {
    const fileIsTarget = ownPatterns.some((regex) => regex.test(record.name));
    const patterns = fileIsTarget ? groupPatterns : [];
    if (!patterns.length) continue;
    const matches = collectPriorityMatches(record.lines, behavior.priorityPatterns, patterns, limitPerFile);
    if (matches.length) rows.push({ file: record.name, role: record.role, matches });
  }
  return rows;
}

function summarizeGroups(fileRecords) {
  const summary = {};
  for (const [name, patterns] of Object.entries(patternGroups)) {
    let matchCount = 0;
    const files = [];
    for (const record of fileRecords) {
      const matches = collectMatches(record.lines, patterns, 500);
      if (matches.length) {
        files.push(record.name);
        matchCount += matches.length;
      }
    }
    summary[name] = { files, matchCount };
  }
  return summary;
}

function buildMethodIndex(fileRecords) {
  const methodPattern = /\b(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/g;
  const interesting = /Click|click|Handler|render|Render|overlay|Overlay|find|Find|close|Close|open|Open|auto|Auto|Skill|Card|Move|Effect|shop|KanShu|Rogue|Table|Scene|Window|verify|record|capture/;
  const rows = [];
  for (const record of fileRecords) {
    const seen = new Set();
    record.lines.forEach((line, index) => {
      for (const match of line.matchAll(methodPattern)) {
        const name = match[1] || match[2] || "";
        if (!name || seen.has(name) || !interesting.test(name)) continue;
        seen.add(name);
        rows.push({ file: record.name, lineNumber: index + 1, name, line: trimLine(line) });
      }
    });
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.lineNumber - b.lineNumber);
}

function buildMarkdown({ fileRecords, groupSummary, behaviorRows, methodIndex, outDir }) {
  const lines = [];
  lines.push("# 旧 devBrowserTools 脚本行为图谱");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Source backup dir: ${backupDir}`);
  lines.push(`- Output dir: ${outDir}`);
  lines.push(`- Script files scanned: ${fileRecords.length}`);
  lines.push("");
  lines.push("## 结论摘要");
  lines.push("");
  lines.push("- 旧脚本的稳定监控核心不是 console.log，而是 Chrome CDP 注入到页面 JavaScript 后直接遍历 `window.Laya.stage`，读取 scene/window/manager 实例。");
  lines.push("- 自动 UI 的生命周期都应绑定 visible scene：记牌器绑定 `TableGameScene`，山河图奖励绑定 `RogueSmallMapScene`，窗口类功能绑定 `WindowLayer/mWt` 中的实际窗口实例。");
  lines.push("- DOM overlay 必须 `pointer-events: none`，只显示不截获游戏输入；真正点击/确认优先调用 Laya 实例方法，而不是按图片坐标点。");
  lines.push("- 购买、充值、刷新商店等动作只保留识别和 guard，不作为自由探索动作执行。");
  lines.push("- 神诸葛/七星类“武将牌上”的牌在旧记牌器里归入公开 general zone / publicPools；旧脚本没有发现独立的 `神诸葛` 专名入口，需靠日志、公开区和弹窗可见字段验证。");
  lines.push("");

  lines.push("## 脚本清单");
  lines.push("");
  lines.push("| File | Role | Lines | Key Groups |");
  lines.push("| --- | --- | ---: | --- |");
  for (const record of fileRecords) {
    const groups = Object.entries(patternGroups)
      .filter(([, patterns]) => collectMatches(record.lines, patterns, 1).length)
      .map(([name]) => name)
      .join(", ");
    lines.push(`| ${escapeMd(record.name)} | ${escapeMd(record.role)} | ${record.lines.length} | ${escapeMd(groups)} |`);
  }
  lines.push("");

  lines.push("## 行为实现图谱");
  lines.push("");
  for (const behavior of behaviorDefinitions) {
    const rows = behaviorRows[behavior.id] || [];
    lines.push(`### ${behavior.title}`);
    lines.push("");
    lines.push(`- Behavior id: \`${behavior.id}\``);
    lines.push(`- 监控方式: ${behavior.monitoring}`);
    lines.push(`- 触发/停止: ${behavior.trigger}`);
    lines.push(`- 动作: ${behavior.action}`);
    lines.push(`- 风险边界: ${behavior.risk}`);
    lines.push("");
    lines.push("| Evidence file | Lines |");
    lines.push("| --- | --- |");
    if (!rows.length) {
      lines.push("| (none) | No direct old-script match. |");
    } else {
      for (const row of rows) {
        const snippets = row.matches
          .slice(0, 8)
          .map((match) => `L${match.lineNumber}: ${match.line}`)
          .join("<br>");
        lines.push(`| ${escapeMd(row.file)} | ${escapeMd(snippets)} |`);
      }
    }
    lines.push("");
  }

  lines.push("## Pattern Group Coverage");
  lines.push("");
  lines.push("| Group | Files | Match count (limited scan) |");
  lines.push("| --- | ---: | ---: |");
  for (const [name, summary] of Object.entries(groupSummary)) {
    lines.push(`| ${escapeMd(name)} | ${summary.files.length} | ${summary.matchCount} |`);
  }
  lines.push("");

  lines.push("## Interesting Method/Function Names");
  lines.push("");
  lines.push("| File | Line | Name | Source |");
  lines.push("| --- | ---: | --- | --- |");
  for (const row of methodIndex.slice(0, 400)) {
    lines.push(`| ${escapeMd(row.file)} | ${row.lineNumber} | \`${escapeMd(row.name)}\` | ${escapeMd(row.line)} |`);
  }
  if (methodIndex.length > 400) {
    lines.push(`| ... | ... | ... | ${methodIndex.length - 400} additional rows omitted in markdown; see JSON. |`);
  }
  lines.push("");

  lines.push("## 可实现监控方法清单");
  lines.push("");
  lines.push("| Topic | Stable hook | Trigger condition | Stop/cleanup condition |");
  lines.push("| --- | --- | --- | --- |");
  lines.push("| 记牌器 UI | `Laya.stage -> visible TableGameScene -> manager.seats/log/public zones` | `TableGameScene` effectiveVisible 且 seats 存在 | scene 不可见、无 seats、游戏结束/结果窗口、渲染异常时 remove overlay/清 ledger |");
  lines.push("| 山河图奖励 UI | `Laya.stage -> visible RogueSmallMapScene -> PveMgr/cityView` | `RogueSmallMapScene` effectiveVisible | scene/canvas/city item 不可见时 remove overlay |");
  lines.push("| 祈福/发财树 UI | `WindowLayer/mWt -> KanShuWindow/wXi` 或游戏窗口系统创建隐藏实例 | 窗口实例存在且状态允许 | 关闭窗口、移除监听、非免费分支停止 |");
  lines.push("| 山河图商店 | `RogueSmallMapScene.PveMgr.ShopData` 或 `shopBtnClick()` 后 `RogueJiShiWindow` | 已在山河图小地图；ShopData 缺失时请求 16 | 关闭 `RogueJiShiWindow`，恢复 localStorage，禁止 buy/refresh |");
  lines.push("| 按钮点击 | Laya 节点实例方法，如 `shopBtnClick`/`OnClickCity`/window `Close` | 找到 effectiveVisible 节点且方法存在 | 动作后重新读 scene/window 状态 |");
  lines.push("| 自动选牌/丢弃/技能 | `SelectCardWindow`/`SkillSelectorWindow`/协议事件/相关 responder 方法 | 窗口 visible 且候选牌/按钮可读 | 未验证候选、涉及购买或未知牌来源时停止 |");
  lines.push("| 弹出特效/屏蔽 | Scene/window 原型方法、effect pool、Tween/Animation 调用点 | 特效方法被调用或节点创建 | 以 hook 返回/隐藏节点为主，保留恢复函数 |");
  lines.push("");

  lines.push("## 剩余需 live 验证的点");
  lines.push("");
  lines.push("- `神诸葛/七星` 弹窗的当前 runtime 字段：旧脚本证明了 `武将牌上`/public general zone 处理方式，但没有单独证明当前弹窗类名和点击路径。");
  lines.push("- `严教` 右侧候选列表和自动分配：需要在 visible `YanJiaoWindow` 中 hook/读取当前候选牌容器、目标状态容器和确认方法。");
  lines.push("- 自动选牌/自动丢弃/自动技能：旧脚本提供关键词和窗口类型，仍需按具体窗口实例做一轮安全 live sample。");
  lines.push("- 屏蔽特效：旧脚本关键词能定位 Effect/Tween/Animation，但需要选定具体要屏蔽的 runtime 方法后验证恢复。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const fileRecords = [];
  for (const name of files) {
    const fullPath = path.join(backupDir, name);
    const text = await readFile(fullPath, "utf8");
    const lines = text.split(/\r?\n/);
    fileRecords.push({
      name,
      path: fullPath,
      role: roleForFile(name),
      lineCount: lines.length,
      lines
    });
  }

  const groupSummary = summarizeGroups(fileRecords);
  const behaviorRows = Object.fromEntries(
    behaviorDefinitions.map((behavior) => [behavior.id, collectBehaviorMatches(fileRecords, behavior)])
  );
  const methodIndex = buildMethodIndex(fileRecords);

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });

  const json = {
    generatedAt: new Date().toISOString(),
    backupDir,
    outputDir: outDir,
    files: fileRecords.map((record) => ({
      name: record.name,
      path: record.path,
      role: record.role,
      lineCount: record.lineCount
    })),
    groupSummary,
    behaviors: behaviorDefinitions.map((behavior) => ({
      ...behavior,
      files: behavior.files.map(String),
      evidence: behaviorRows[behavior.id] || []
    })),
    methodIndex
  };

  await writeFile(path.join(outDir, "old-script-behavior-map.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "old-script-behavior-map.md"), buildMarkdown({
    fileRecords,
    groupSummary,
    behaviorRows,
    methodIndex,
    outDir
  }), "utf8");

  console.log(JSON.stringify({
    dir: outDir,
    scripts: fileRecords.length,
    behaviors: behaviorDefinitions.length,
    methods: methodIndex.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

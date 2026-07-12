(() => {
  const root = window.__SgsScripts;

  const childrenOf = (node) => {
    if (!node) return [];
    if (Array.isArray(node._children)) return node._children;
    if (Array.isArray(node._childs)) return node._childs;
    if (Array.isArray(node.children)) return node.children;
    if (typeof node.numChildren === "number" && typeof node.getChildAt === "function") {
      const list = [];
      for (let i = 0; i < node.numChildren; i++) {
        try {
          list.push(node.getChildAt(i));
        } catch {}
      }
      return list;
    }
    return [];
  };

  const traverse = (rootNode, visit, limit = 90000) => {
    const stack = [rootNode];
    const seen = new Set();
    let count = 0;
    while (stack.length && count < limit) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      count++;
      visit(node);
      const children = childrenOf(node);
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return count;
  };

  const labelOf = (node) =>
    String(node?.sceneName || node?._className_ || node?.name || node?.constructor?.name || "");

  const nodeIndexInParent = (node) => {
    const parent = node?.parent;
    if (!parent) return -1;
    return childrenOf(parent).indexOf(node);
  };

  const nodePath = (node, limit = 40) => {
    const parts = [];
    let cur = node;
    let depth = 0;
    while (cur && depth < limit) {
      const label = labelOf(cur) || cur?.constructor?.name || "Node";
      const index = nodeIndexInParent(cur);
      parts.push(index >= 0 ? `${label}#${index}` : label);
      cur = cur.parent;
      depth++;
    }
    return parts.reverse().join("/");
  };

  const nodeDebugInfo = (node) => {
    if (!node) return null;
    return {
      label: labelOf(node),
      name: String(node.name || ""),
      sceneName: String(node.sceneName || ""),
      className: String(node._className_ || node.constructor?.name || ""),
      path: nodePath(node),
      childIndex: nodeIndexInParent(node),
      x: Number(node.x || 0),
      y: Number(node.y || 0),
      width: Number(node.width || node._width || 0),
      height: Number(node.height || node._height || 0),
      visible: node.visible !== false,
      alpha: Number(node.alpha == null ? 1 : node.alpha)
    };
  };

  const ownVisible = (node) =>
    !!node &&
    node.visible !== false &&
    Number(node.alpha == null ? 1 : node.alpha) !== 0 &&
    Number(node.scaleX == null ? 1 : node.scaleX) !== 0 &&
    Number(node.scaleY == null ? 1 : node.scaleY) !== 0 &&
    !node.destroyed;

  const effectiveVisible = (node) => {
    let cur = node;
    while (cur) {
      if (!ownVisible(cur)) return false;
      cur = cur.parent;
    }
    return true;
  };

  const globalPoint = (node, x = 0, y = 0) => {
    try {
      if (node?.localToGlobal && window.Laya?.Point) {
        const point = node.localToGlobal(new window.Laya.Point(x, y));
        return { x: Number(point.x || 0), y: Number(point.y || 0) };
      }
    } catch {}
    return { x: Number(node?.x || 0) + x, y: Number(node?.y || 0) + y };
  };

  const visualRect = (node) => {
    const width = Number(node?.width || node?._width || 0);
    const height = Number(node?.height || node?._height || 0);
    const p0 = globalPoint(node, 0, 0);
    const p1 = globalPoint(node, width, height);
    return {
      left: Math.min(p0.x, p1.x),
      top: Math.min(p0.y, p1.y),
      width: Math.abs(p1.x - p0.x) || width,
      height: Math.abs(p1.y - p0.y) || height
    };
  };

  const findTableGameScene = () => {
    let scene = null;
    traverse(window.Laya?.stage, (node) => {
      if (!scene && /TableGameScene/.test(labelOf(node)) && effectiveVisible(node)) scene = node;
    });
    return scene;
  };

  const findAvatarNodes = (scene, seats) => {
    const rows = [];
    traverse(scene, (node) => {
      if (!effectiveVisible(node)) return;
      const seatIndex = seats.indexOf(node?.seat);
      if (seatIndex < 0) return;
      const skin = String(node?.skin || node?._skin || node?.texture?.url || node?._texture?.url || "");
      const label = labelOf(node);
      if (label !== "pWt" && !/general\/seat\/static\/generalface_/.test(skin)) return;
      rows.push({ seatIndex, node, rect: visualRect(node) });
    });
    return rows;
  };

  const decodeHtmlEntity = (entity) => {
    const named = {
      "&amp;": "&",
      "&apos;": "'",
      "&#39;": "'",
      "&gt;": ">",
      "&lt;": "<",
      "&nbsp;": " ",
      "&quot;": '"'
    };
    const namedValue = named[entity.toLowerCase()];
    if (namedValue !== undefined) return namedValue;
    const numeric = /^&#(x[\da-f]+|\d+);$/i.exec(entity);
    if (!numeric) return entity;
    const codePoint = numeric[1][0].toLowerCase() === "x"
      ? Number.parseInt(numeric[1].slice(1), 16)
      : Number.parseInt(numeric[1], 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  };

  const decodeHtml = (value) => String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|apos|gt|lt|nbsp|quot|#39|#\d+|#x[\da-f]+);/gi, decodeHtmlEntity);

  const stripHtml = (value) => decodeHtml(value).replace(/\s+/g, " ").trim();

  const normalizePlayerName = (value) =>
    stripHtml(value)
      .replace(/\(您\)/g, "")
      .replace(/[“”"]/g, "")
      .trim();

  const suitMap = { 1: "♥", 2: "♦", 3: "♠", 4: "♣" };
  const rankMap = { 1: "A", 11: "J", 12: "Q", 13: "K" };

  const cardColorName = (suit) => {
    if (suit === "♥" || suit === "♦") return "red";
    if (suit === "♠" || suit === "♣") return "black";
    return "";
  };

  const cardText = (card) => {
    if (!card) return "";
    return [card.name, card.suit, card.rank].filter(Boolean).join("") || String(card.text || card.id || "");
  };

  const runtimeCard = (card) => {
    if (!card) return null;
    const id = card.cardId ?? card.CardId ?? card.id ?? card.Id;
    const name = card.cardName || card.Name || card.name || card.CardName || "";
    const suit = suitMap[card.cardFlower ?? card.CardFlower ?? card.Suit ?? card.suit] || "";
    const rawRank = card.cardNumber ?? card.cardNumberOri ?? card.Number ?? card.number;
    const rank = rankMap[rawRank] || (rawRank ? String(rawRank) : "");
    const result = { id, name, suit, rank, color: cardColorName(suit) };
    result.text = cardText(result);
    return result.id != null || result.text ? result : null;
  };

  const readLogEntries = (scene) => {
    let bestBox = null;
    let bestCount = 0;
    traverse(scene, (node) => {
      const children = childrenOf(node);
      let count = 0;
      for (const child of children) {
        const html = String(child?._innerHTML || "");
        if (/<font\b/i.test(html) && /(手牌区|摸牌堆|牌堆顶|牌堆底|使用|弃置|重铸|装备|获得|置于|打出|展示|观看|亮出|判定)/.test(html)) {
          count++;
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestBox = node;
      }
    });
    if (!bestBox) return [];
    return childrenOf(bestBox)
      .map((node, index) => {
        const html = String(node?._innerHTML || "");
        return { index, html, text: stripHtml(html) };
      })
      .filter((entry) => entry.html && /<font\b/i.test(entry.html));
  };

  const buildSeatNames = (seats) => {
    const nameToSeat = new Map();
    const seatNames = seats.map((seat, index) => {
      const names = [];
      const add = (value) => {
        const name = normalizePlayerName(value);
        if (name && !names.includes(name)) names.push(name);
      };
      add(seat?.general?.specifyName);
      add(seat?.general?.cardName);
      add(seat?.general?.trueSpecifyName ? String(seat.general.trueSpecifyName) + String(seat?.general?.cardName || "") : "");
      add(seat?.playerInfo?.nickname);
      for (const name of names) nameToSeat.set(name, index);
      return names;
    });
    return { nameToSeat, seatNames };
  };

  Object.assign(root.utils, {
    childrenOf,
    traverse,
    labelOf,
    nodePath,
    nodeDebugInfo,
    ownVisible,
    effectiveVisible,
    globalPoint,
    visualRect,
    findTableGameScene,
    findAvatarNodes,
    stripHtml,
    decodeHtml,
    normalizePlayerName,
    cardText,
    runtimeCard,
    readLogEntries,
    buildSeatNames,
    cardColorName
  });
})();

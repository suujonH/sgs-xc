const ZONE_NAMES = [
  "outside",
  "pile",
  "discard",
  "process",
  "mark",
  "hand",
  "equip",
  "judge",
  "popup",
  "shuffle",
  "swap",
  "discard-temp",
  "removed"
];

const CHANNELS = { 1: "综合", 2: "世界", 3: "私聊", 4: "房间", 5: "公会", 6: "战队" };

const OLD_PROTOCOLS = [
  "PubGsCMoveCard",
  "PubGsCUseCard",
  "PubGsCUseSpell",
  "GsCTriggerSpellNew",
  "GsCTriggerSpellEnq",
  "GsCGamephaseNtf",
  "MsgGameTurnNtf",
  "MsgGameRoundNtf",
  "decodeMsgSetGamePhaseNtf",
  "MsgGameOver",
  "MsgEnterGameStageNtf",
  "GsCStartGameRep",
  "GsCUpdateRoleDataNtf",
  "GsCUpdateRoleDataExNtf",
  "GsCUpdateHpNtf",
  "MsgUpdateShieldNtf",
  "MsgActionStateNtf",
  "GsCFirstPhaseRole",
  "SmsgGameSetCharacter",
  "GsCGuoZhanSetCharacter",
  "decodeMsgCharacterSelectInfoNtf",
  "MsgGamePlayCardNtf",
  "ClientHappyGetFriendHandcardRep",
  "MsgNtfUseCardType",
  "GsCRoleOptNtf",
  "GsCRoleOptTargetNtf",
  "CGsRoleSpellOptRep",
  "decodeSSCChatmsgNtf",
  "decodeSSCQuickChatmsgNtf",
  "ClientOtheruserLeavetableNtf",
  "GsCUserpreapreNtf"
];

function createProtocolContext(initial = {}) {
  return {
    turn: numberOr(initial.turn, 0),
    round: numberOr(initial.round, 0),
    phase: numberOr(initial.phase, 0)
  };
}

function cleanProto(wrapper) {
  const msg = wrapper?.msg;
  const raw = msg?.ProtoObj || msg?.data?.protoObj || wrapper?.ProtoObj || null;
  if (!raw || typeof raw !== "object") return null;
  const clean = {};
  for (const key in raw) {
    if (key === "_className_" || key.startsWith("_")) continue;
    const value = raw[key];
    if (typeof value !== "function") clean[key] = value;
  }
  return {
    msgId: msg?.id,
    className: msg?.ClassName || msg?._className_ || raw?._className_ || "",
    data: clean
  };
}

function updateContext(context, data) {
  const target = context || createProtocolContext();
  const oldPhase = numberOr(target.phase, 0);
  const turn = first(data, "turn", "Turn");
  const round = first(data, "round", "Round");
  const phase = first(data, "phase", "Phase");

  if (turn != null) target.turn = Number(turn);
  if (round != null) target.round = Number(round);
  if (phase != null) {
    const nextPhase = Number(phase);
    if (Number.isFinite(nextPhase)) {
      if (nextPhase < oldPhase && nextPhase <= 1 && oldPhase >= 5) target.turn = numberOr(target.turn, 0) + 1;
      target.phase = nextPhase;
    }
  }
  return target;
}

function parseProtocol(name, wrapper, options = {}) {
  const proto = cleanProto(wrapper);
  if (!proto) return null;
  const data = proto.data;
  const context = updateContext(options.context || createProtocolContext(), data);
  const ctx = { ...context, seatCount: numberOr(options.seatCount, 0) };
  const meta = {
    protocol: name,
    msgId: proto.msgId,
    context: ctx,
    raw: safeObject(data)
  };
  const cardInfo = typeof options.cardInfo === "function" ? options.cardInfo : () => null;
  const skillRule = typeof options.skillRule === "function" ? options.skillRule : () => null;

  if (name === "PubGsCMoveCard") {
    const fromCode = first(data, "fromZone", "FromZone");
    const toCode = first(data, "toZone", "ToZone");
    const skillId = Number(first(data, "spellId", "SpellID", "skillId", "SkillID") || 0);
    const fromVisibleHandCards = visibleHandPayloads(
      first(data, "fromVisibleHandCards", "FromVisibleHandCards", "from_visible_hand_cards"),
      cardInfo
    );
    const toVisibleHandCards = visibleHandPayloads(
      first(data, "toVisibleHandCards", "ToVisibleHandCards", "to_visible_hand_cards"),
      cardInfo
    );
    const listedCards = Array.isArray(data.data)
      ? data.data.map((card) => protocolCardPayload(card, cardInfo)).filter((card) => card.id > 0)
      : [];
    const visibleFallback = Number(fromCode) === 5
      ? fromVisibleHandCards
      : Number(toCode) === 5
        ? toVisibleHandCards
        : [];
    const cards = listedCards.length ? listedCards : visibleFallback;
    const ids = cards.map((card) => card.id);
    return {
      ...meta,
      type: "card:move",
      cards,
      from: {
        seat: first(data, "fromId", "FromID"),
        zone: zoneName(fromCode),
        code: fromCode,
        position: first(data, "fromPosition", "FromPosition"),
        zoneParam: first(data, "fromZoneParam", "FromZoneParam")
      },
      to: {
        seat: first(data, "toId", "ToID"),
        zone: zoneName(toCode),
        code: toCode,
        position: first(data, "toPosition", "ToPosition"),
        zoneParam: first(data, "toZoneParam", "ToZoneParam")
      },
      count: first(data, "cardCnt", "CardCount", "dataCnt") || ids.length || 0,
      moveType: first(data, "typeMove", "MoveType"),
      positions: {
        from: first(data, "fromPosition", "FromPosition"),
        to: first(data, "toPosition", "ToPosition")
      },
      zoneParams: {
        from: first(data, "fromZoneParam", "FromZoneParam"),
        to: first(data, "toZoneParam", "ToZoneParam")
      },
      visibleHandCards: {
        from: fromVisibleHandCards,
        to: toVisibleHandCards
      },
      identitySource: listedCards.length
        ? "protocol-card-ids"
        : visibleFallback.length
          ? Number(fromCode) === 5 ? "from-visible-hand-cards" : "to-visible-hand-cards"
          : "unlisted",
      srcSeat: first(data, "srcSeatId", "SrcSeatID"),
      skillId,
      skillRule: skillRule(skillId)
    };
  }

  if (name === "PubGsCUseCard") {
    const cardId = Number(first(data, "cardId", "CardID") || 0);
    const skillId = Number(first(data, "spellId", "SpellID") || 0);
    return {
      ...meta,
      type: "card:use",
      card: cardId ? cardPayload(cardId, cardInfo) : null,
      seat: first(data, "srcSeatId", "SeatID", "seatId"),
      targetSeats: Array.isArray(data.data) ? data.data.slice(0, Number(first(data, "paramCnt", "paramCount") || data.data.length)) : [],
      fromZone: first(data, "fromZone", "FromZone"),
      useType: first(data, "usetype", "useType"),
      skillId,
      skillRule: skillRule(skillId)
    };
  }

  if (name === "PubGsCUseSpell" || name === "GsCTriggerSpellNew" || name === "GsCTriggerSpellEnq") {
    const rawSkillId = first(data, "spellId", "SpellID", "srcSpellId", "src_spell_id", "SrcSpellID", "trigger_spell_id");
    const skillId = Number(Array.isArray(rawSkillId) ? rawSkillId[0] : rawSkillId || 0);
    return {
      ...meta,
      type: "skill:use",
      skillId,
      skillRule: skillRule(skillId),
      seat: first(data, "triggerSeatId", "trigger_seat_id", "TriggerSeatId", "srcSeatId", "SeatID"),
      casterSeat: first(data, "srcSpellCasterSeat", "src_spell_caster_seat", "SrcSpellCasterSeat"),
      targets: Array.isArray(data.datas) ? data.datas : (Array.isArray(data.data) ? data.data : []),
      count: first(data, "uTriggerSpellCnt", "useCardCount", "TriggerSpellCnt")
    };
  }

  if (name === "GsCRoleOptTargetNtf" || name === "CGsRoleSpellOptRep") {
    const skillId = Number(first(data, "spell_id", "spellId", "SpellID") || 0);
    return {
      ...meta,
      type: "skill:option",
      skillId,
      skillRule: skillRule(skillId),
      optSeat: first(data, "opt_seat_id", "seat_id", "seatId", "SeatID"),
      targetSeat: first(data, "target_seat_id", "targetSeatId"),
      casterSeat: first(data, "spell_caster_seat", "spellCasterSeat"),
      optType: first(data, "opt_type", "optType", "OptType")
    };
  }

  if (name === "MsgGameTurnNtf") {
    const turn = first(data, "turnCnt", "turn_cnt", "TurnCnt", "turn", "Turn") ?? context.turn;
    if (turn != null) context.turn = Number(turn);
    return {
      ...meta,
      context: { ...context, seatCount: ctx.seatCount },
      type: "game:turn",
      turn: context.turn,
      seat: first(data, "seat_id", "seatId", "SeatID"),
      round: context.round,
      phase: context.phase
    };
  }

  if (name === "MsgGameRoundNtf") {
    const round = first(data, "roundCnt", "round_cnt", "RoundCnt", "round", "Round") ?? context.round;
    if (round != null) context.round = Number(round);
    return {
      ...meta,
      context: { ...context, seatCount: ctx.seatCount },
      type: "game:round",
      round: context.round
    };
  }

  if (name === "GsCGamephaseNtf" || name === "decodeMsgSetGamePhaseNtf") {
    const phase = first(data, "phase", "Phase") ?? context.phase;
    if (phase != null) context.phase = Number(phase);
    return {
      ...meta,
      context: { ...context, seatCount: ctx.seatCount },
      type: "game:phase",
      seat: first(data, "curSeatId", "seatId", "SeatID"),
      round: first(data, "round", "Round") ?? context.round,
      phase: context.phase
    };
  }

  if (name === "GsCUpdateRoleDataNtf") {
    return {
      ...meta,
      type: "game:stateChange",
      seat: first(data, "seat_id", "seatId", "SeatID"),
      stateId: first(data, "data_id", "dataId", "StateID", "DataID"),
      value: first(data, "data", "Value"),
      reason: first(data, "reason", "Reason")
    };
  }

  if (name === "GsCUpdateHpNtf") {
    const skillId = Number(first(data, "spellId", "SpellID") || 0);
    const rule = skillRule(skillId);
    return {
      ...meta,
      type: "player:hp",
      seat: first(data, "murder_SeatId", "murder_seatId", "seat_id", "seatId", "SeatID"),
      damage: first(data, "damage", "Damage"),
      property: first(data, "damage_property", "damageProperty", "Property"),
      skillId,
      skillName: rule?.name || "",
      skillRule: rule
    };
  }

  if (name === "MsgUpdateShieldNtf") {
    return {
      ...meta,
      type: "player:shield",
      seat: first(data, "seat_id", "seatId", "SeatID"),
      shield: first(data, "shield", "Shield", "data", "value")
    };
  }

  if (name === "MsgActionStateNtf") {
    return {
      ...meta,
      type: "game:actionState",
      actionId: first(data, "action_id", "actionId", "ActionID"),
      actionType: first(data, "action_type", "actionType", "ActionType")
    };
  }

  if (name === "MsgEnterGameStageNtf" || name === "GsCStartGameRep") {
    return {
      ...meta,
      type: "game:stage",
      stage: first(data, "stage", "Stage", "data", "gameStage")
    };
  }

  if (name === "GsCFirstPhaseRole") {
    return {
      ...meta,
      type: "game:firstPhaseRole",
      seat: first(data, "seat_id", "seatId", "SeatID"),
      role: first(data, "role", "Role", "data")
    };
  }

  if (name === "GsCUpdateRoleDataExNtf") {
    return {
      ...meta,
      type: "game:stateChangeEx",
      seat: first(data, "seat_id", "seatId", "SeatID"),
      isSpell: first(data, "bspell", "isSpell", "IsSpell"),
      dataId: first(data, "id", "dataId", "DataID"),
      datas: Array.isArray(data.data) ? data.data : (Array.isArray(data.Datas) ? data.Datas : [])
    };
  }

  if (name === "decodeSSCChatmsgNtf") {
    const channelId = first(data, "Channel", "channel");
    return {
      ...meta,
      type: "chat:message",
      channel: CHANNELS[channelId] || (channelId == null ? "" : `?${channelId}`),
      channelId,
      speakerId: first(data, "SpokerMan", "spokerMan", "msgId"),
      content: first(data, "chatMsg", "ChatMsg") || ""
    };
  }

  if (name === "decodeSSCQuickChatmsgNtf") {
    const channelId = first(data, "Channel", "channel");
    return {
      ...meta,
      type: "chat:quickMessage",
      channel: CHANNELS[channelId] || (channelId == null ? "" : `?${channelId}`),
      channelId,
      speakerId: first(data, "SpokerMan", "spokerMan", "msgId"),
      quickId: first(data, "quickId", "QuickID", "quick_msg_id", "data"),
      content: first(data, "chatMsg", "ChatMsg") || ""
    };
  }

  if (name === "MsgGameOver") {
    return {
      ...meta,
      type: "game:over"
    };
  }

  if (name === "SmsgGameSetCharacter" || name === "GsCGuoZhanSetCharacter" || name === "decodeMsgCharacterSelectInfoNtf") {
    const list = Array.isArray(data.Infos) ? data.Infos : (Array.isArray(data.infos) ? data.infos : null);
    const characters = list
      ? list.map(characterPayload)
      : [characterPayload(data)];
    return {
      ...meta,
      type: "game:selectCharacter",
      characters,
      seat: characters[0]?.seat,
      characterId: characters[0]?.characterId,
      country: characters[0]?.country
    };
  }

  if (name === "MsgGamePlayCardNtf") {
    const rawCards = Array.isArray(data.data)
      ? data.data
      : (Array.isArray(data.CardList) ? data.CardList : (Array.isArray(data.CardIDs) ? data.CardIDs : []));
    return {
      ...meta,
      type: "game:dealCards",
      cards: rawCards.map((card) => protocolCardPayload(card, cardInfo)).filter((card) => card.id > 0),
      count: first(data, "cardCnt", "cardCount", "CardCount") || rawCards.length
    };
  }

  if (name === "ClientHappyGetFriendHandcardRep") {
    const rawCards = Array.isArray(data.cardList) ? data.cardList : (Array.isArray(data.CardList) ? data.CardList : []);
    return {
      ...meta,
      type: "hand:friendHandCards",
      seat: first(data, "seatId", "SeatID", "seat_id"),
      cards: rawCards.map((card) => protocolCardPayload(card, cardInfo)).filter((card) => card.id > 0),
      count: rawCards.length,
      sourceRule: "protocol-authorized-friend-hand"
    };
  }

  if (name === "MsgNtfUseCardType") {
    const skillId = Number(first(data, "spellId", "SpellID") || 0);
    return {
      ...meta,
      type: "card:useType",
      cardType: first(data, "type", "Type"),
      skillId,
      skillRule: skillRule(skillId),
      destCount: first(data, "destCnt", "destCount", "DestCount"),
      useType: first(data, "usetype", "useType"),
      targets: Array.isArray(data.data) ? data.data : []
    };
  }

  if (name === "ClientOtheruserLeavetableNtf") {
    return {
      ...meta,
      type: "player:leave",
      userTempId: first(data, "UserTempID", "userTempId"),
      seat: first(data, "seatId", "SeatID")
    };
  }

  if (name === "GsCUserpreapreNtf") {
    const list = Array.isArray(data.Infos) ? data.Infos : (Array.isArray(data.infos) ? data.infos : null);
    const players = list
      ? list.map(readyPayload)
      : [readyPayload(data)];
    return {
      ...meta,
      type: "player:ready",
      players,
      seat: players[0]?.seat,
      ready: players[0]?.ready
    };
  }

  if (name === "GsCRoleOptNtf") {
    return {
      ...meta,
      type: "game:roleOpt",
      seat: first(data, "seat_id", "seatId", "SeatID"),
      optType: first(data, "opt_type", "optType", "OptType", "Type"),
      timeout: first(data, "time_out", "Timeout"),
      discardCount: first(data, "discardCount", "DiscardCount")
    };
  }

  return {
    ...meta,
    type: "protocol"
  };
}

function cardPayload(id, cardInfo) {
  const info = cardInfo(id) || {};
  return {
    id,
    name: info.name || null,
    color: info.color || null,
    number: info.number || null,
    suit: info.suit || "",
    rank: info.rank || "",
    ncn: info.ncn || "",
    spellId: Number(info.spellId || 0)
  };
}

function protocolCardPayload(value, cardInfo) {
  const id = normalizeCardId(value);
  const info = id > 0 ? cardInfo(id) || {} : {};
  const payload = cardPayload(id, cardInfo);
  if (value && typeof value === "object") {
    const definition = protocolPhysicalCardDefinition(value, id);
    if (definition.name != null) payload.name = definition.name;
    if (definition.suit != null) {
      payload.suit = definition.suit;
      payload.color = colorFromSuit(definition.suit);
    }
    if (definition.number != null) {
      payload.number = definition.number;
      payload.rank = rankFromNumber(definition.number);
    }
    if (definition.typeOriginal != null) payload.typeOriginal = definition.typeOriginal;
    if (definition.subtype != null) payload.subType = definition.subtype;
    if (definition.spellId != null) payload.spellId = definition.spellId;
    if (Object.keys(definition).some((key) => key !== "id")) {
      payload.definitionObservedFromProtocol = true;
      payload.protocolDefinition = definition;
    }
  }
  if (!payload.name && info.name) payload.name = info.name;
  return payload;
}

function protocolPhysicalCardDefinition(value, id) {
  const definition = { id };
  const name = first(value, "cardName", "name", "CardName");
  const suit = suitFromProtocol(value);
  const number = finiteProtocolNumber(first(
    value,
    "cardPoint",
    "cardNumber",
    "number",
    "point",
    "CardNumber",
    "CardPoint"
  ), { positive: true });
  const typeOriginal = finiteProtocolNumber(first(
    value,
    "typeOriginal",
    "cardTypeOriginal",
    "cardBaseType",
    "cardType",
    "TypeOriginal",
    "CardTypeOriginal",
    "CardBaseType",
    "CardType"
  ), { positive: true });
  const subtype = finiteProtocolNumber(first(value, "cardSubType", "subType", "SubType", "CardSubType"));
  const spellId = finiteProtocolNumber(first(value, "cardSpellId", "spellId", "SpellID", "CardSpellID"), { positive: true });

  if (name != null && String(name).trim()) definition.name = String(name);
  if (suit) definition.suit = suit;
  if (number != null) definition.number = number;
  if (typeOriginal != null) definition.typeOriginal = typeOriginal;
  if (subtype != null) definition.subtype = subtype;
  if (spellId != null) definition.spellId = spellId;
  return definition;
}

function characterPayload(value) {
  return {
    seat: first(value, "SeatID", "seatId", "seatID"),
    characterId: first(value, "CharacterID", "characterId", "GeneralID", "generalId"),
    country: first(value, "Country", "country")
  };
}

function readyPayload(value) {
  return {
    seat: first(value, "SeatID", "seatId", "seatID"),
    ready: first(value, "Ready", "ready", "isReady", "IsReady")
  };
}

function normalizeCardId(value) {
  if (value == null) return 0;
  if (typeof value === "object") {
    return Number(first(value, "id", "cardId", "CardID", "CardId") || 0);
  }
  return Number(value || 0);
}

function visibleHandPayloads(value, cardInfo) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : Array.isArray(value?.cards)
        ? value.cards
        : [];
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const cardValue = row?.card || row;
    const id = normalizeCardId(cardValue);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push({
      ...protocolCardPayload(cardValue, cardInfo),
      positionIndex: first(row, "positionIndex", "position_index") ?? null
    });
  }
  return result;
}

function suitFromProtocol(value) {
  const raw = first(value, "cardSuit", "suit", "color", "cardFlower", "CardFlower", "Suit");
  if (raw == null || raw === "") return "";
  const direct = String(raw).trim().toLowerCase();
  const aliases = {
    "1": "♥",
    "2": "♦",
    "3": "♠",
    "4": "♣",
    "♥": "♥",
    heart: "♥",
    hearts: "♥",
    "♦": "♦",
    diamond: "♦",
    diamonds: "♦",
    "♠": "♠",
    spade: "♠",
    spades: "♠",
    "♣": "♣",
    club: "♣",
    clubs: "♣"
  };
  return aliases[direct] || "";
}

function finiteProtocolNumber(value, options = {}) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (options.positive && number <= 0) return null;
  return number;
}

function rankFromNumber(value) {
  const number = Number(value);
  if (number === 1) return "A";
  if (number === 11) return "J";
  if (number === 12) return "Q";
  if (number === 13) return "K";
  return Number.isFinite(number) && number > 0 ? String(number) : "";
}

function colorFromSuit(value) {
  return value === "♥" || value === "♦" ? "red" : value === "♠" || value === "♣" ? "black" : null;
}

function first(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] != null) return data[key];
  }
  return undefined;
}

function zoneName(code) {
  return ZONE_NAMES[Number(code)] || (code == null ? "" : `?${code}`);
}

function safeObject(value, depth = 0) {
  if (depth > 3 || value == null) return value;
  if (typeof value !== "object") return value;
  if (typeof value === "function") return "[fn]";
  if (Array.isArray(value)) {
    return value.length <= 40 ? value.map((item) => safeObject(item, depth + 1)) : `[Array:${value.length}]`;
  }
  const out = {};
  for (const key of Object.keys(value).slice(0, 30)) {
    if (key.startsWith("_") && key !== "_className_") continue;
    try {
      const item = value[key];
      if (typeof item !== "function") out[key] = safeObject(item, depth + 1);
    } catch {
      out[key] = "[err]";
    }
  }
  return out;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

module.exports = {
  ZONE_NAMES,
  CHANNELS,
  OLD_PROTOCOLS,
  createProtocolContext,
  cleanProto,
  updateContext,
  parseProtocol,
  safeObject,
  first
};

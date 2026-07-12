const assert = require("node:assert/strict");
const {
  createProtocolContext,
  parseProtocol,
  OLD_PROTOCOLS
} = require("../src/runtime/sources/protocol-normalizer-core.cjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error.stack || error);
  }
}

function wrapper(data, id = 1) {
  return {
    msg: {
      id,
      ClassName: "MockProto",
      ProtoObj: data
    }
  };
}

console.log("\nProtocol normalizer core");

test("syncs turn, round, and phase context from game protocols", () => {
  const context = createProtocolContext();
  const turn = parseProtocol("MsgGameTurnNtf", wrapper({ turnCnt: 3, seat_id: 2 }), { context });
  assert.equal(turn.type, "game:turn");
  assert.equal(turn.turn, 3);
  assert.equal(turn.context.turn, 3);
  assert.equal(context.turn, 3);

  const round = parseProtocol("MsgGameRoundNtf", wrapper({ roundCnt: 2 }), { context });
  assert.equal(round.type, "game:round");
  assert.equal(round.round, 2);
  assert.equal(round.context.round, 2);
  assert.equal(context.round, 2);

  const phase = parseProtocol("GsCGamephaseNtf", wrapper({ curSeatId: 1, phase: 6 }), { context });
  assert.equal(phase.type, "game:phase");
  assert.equal(phase.phase, 6);
  assert.equal(phase.context.turn, 3);
  assert.equal(context.phase, 6);
});

test("increments turn when phase wraps from late phase to phase one", () => {
  const context = createProtocolContext({ turn: 4, round: 1, phase: 6 });
  const phase = parseProtocol("GsCGamephaseNtf", wrapper({ phase: 1 }), { context });
  assert.equal(phase.context.turn, 5);
  assert.equal(phase.phase, 1);
  assert.equal(context.turn, 5);
});

test("attaches current context and card metadata to move records", () => {
  const context = createProtocolContext({ turn: 7, round: 2, phase: 4 });
  const parsed = parseProtocol(
    "PubGsCMoveCard",
    wrapper({
      data: [11],
      fromId: 1,
      fromZone: 5,
      toId: 255,
      toZone: 2,
      cardCnt: 1,
      typeMove: 9,
      spellId: 304,
      FromPosition: 1,
      ToPosition: 0,
      FromZoneParam: 7,
      ToZoneParam: 8,
      FromVisibleHandCards: [11, { CardID: 12 }],
      ToVisibleHandCards: [{ cardId: 13 }]
    }),
    {
      context,
      cardInfo: (id) => ({ id, name: "杀", suit: "♠", rank: "7", ncn: "杀♠7", spellId: 1 }),
      skillRule: (id) => ({ id, name: "攻心", categories: ["hand.watch"] })
    }
  );

  assert.equal(parsed.type, "card:move");
  assert.equal(parsed.context.turn, 7);
  assert.deepEqual(parsed.cards, [
    { id: 11, name: "杀", color: null, number: null, suit: "♠", rank: "7", ncn: "杀♠7", spellId: 1 }
  ]);
  assert.deepEqual(parsed.from, { seat: 1, zone: "hand", code: 5, position: 1, zoneParam: 7 });
  assert.deepEqual(parsed.to, { seat: 255, zone: "discard", code: 2, position: 0, zoneParam: 8 });
  assert.deepEqual(parsed.positions, { from: 1, to: 0 });
  assert.deepEqual(parsed.zoneParams, { from: 7, to: 8 });
  assert.deepEqual(parsed.visibleHandCards.from.map((card) => card.id), [11, 12]);
  assert.deepEqual(parsed.visibleHandCards.to.map((card) => card.id), [13]);
  assert.equal(parsed.skillId, 304);
  assert.equal(parsed.skillRule.name, "攻心");
});

test("uses server visible-hand movement cards when ordinary CardIDs are omitted", () => {
  const parsed = parseProtocol(
    "PubGsCMoveCard",
    wrapper({
      data: [],
      fromId: 2,
      fromZone: 5,
      toId: 255,
      toZone: 2,
      cardCnt: 1,
      FromVisibleHandCards: [{ card: { CardID: 12 }, position_index: 3 }]
    }),
    { cardInfo: (id) => ({ id, name: id === 12 ? "闪" : "" }) }
  );

  assert.deepEqual(parsed.cards.map((card) => card.id), [12]);
  assert.equal(parsed.cards[0].definitionObservedFromProtocol, undefined);
  assert.equal(parsed.identitySource, "from-visible-hand-cards");
  assert.deepEqual(parsed.visibleHandCards.from.map((card) => card.id), [12]);
});

test("preserves a server-supplied physical definition for a generated CardID", () => {
  const parsed = parseProtocol(
    "PubGsCMoveCard",
    wrapper({
      data: [{
        CardID: 90001,
        cardSuit: 4,
        cardPoint: 8,
        cardName: "闪",
        cardTypeOriginal: 1,
        cardSpellId: 2
      }],
      fromId: 255,
      fromZone: 1,
      toId: 1,
      toZone: 5,
      cardCnt: 1
    }),
    { cardInfo: () => null }
  );

  assert.equal(parsed.cards[0].id, 90001);
  assert.equal(parsed.cards[0].name, "闪");
  assert.equal(parsed.cards[0].suit, "♣");
  assert.equal(parsed.cards[0].color, "black");
  assert.equal(parsed.cards[0].number, 8);
  assert.equal(parsed.cards[0].rank, "8");
  assert.equal(parsed.cards[0].typeOriginal, 1);
  assert.equal(parsed.cards[0].spellId, 2);
  assert.equal(parsed.cards[0].definitionObservedFromProtocol, true);
  assert.deepEqual(parsed.cards[0].protocolDefinition, {
    id: 90001,
    name: "闪",
    suit: "♣",
    number: 8,
    typeOriginal: 1,
    spellId: 2
  });
});

test("normalizes state, hp, shield, and role option records", () => {
  const context = createProtocolContext({ turn: 1, round: 0, phase: 3 });

  const stateChange = parseProtocol("GsCUpdateRoleDataNtf", wrapper({ seat_id: 4, data_id: 88, data: 2 }), { context });
  assert.equal(stateChange.type, "game:stateChange");
  assert.equal(stateChange.seat, 4);
  assert.equal(stateChange.stateId, 88);
  assert.equal(stateChange.value, 2);
  assert.equal(stateChange.context.phase, 3);

  const hp = parseProtocol("GsCUpdateHpNtf", wrapper({ murder_SeatId: 2, damage: -1, damage_property: 1, spellId: 304 }), {
    context,
    skillRule: (id) => ({ id, name: "攻心" })
  });
  assert.equal(hp.type, "player:hp");
  assert.equal(hp.skillId, 304);
  assert.equal(hp.skillName, "攻心");
  assert.equal(hp.damage, -1);

  const shield = parseProtocol("MsgUpdateShieldNtf", wrapper({ SeatID: 3, Shield: 5 }), { context });
  assert.equal(shield.type, "player:shield");
  assert.equal(shield.seat, 3);
  assert.equal(shield.shield, 5);

  const roleOpt = parseProtocol("GsCRoleOptNtf", wrapper({ seat_id: 1, opt_type: 7, time_out: 15, DiscardCount: 2 }), { context });
  assert.equal(roleOpt.type, "game:roleOpt");
  assert.equal(roleOpt.timeout, 15);
  assert.equal(roleOpt.discardCount, 2);
});

test("normalizes character, deal, ready, leave, stage, chat, and game over records", () => {
  const context = createProtocolContext({ turn: 2, round: 1, phase: 4 });

  const characters = parseProtocol(
    "SmsgGameSetCharacter",
    wrapper({ Infos: [{ SeatID: 1, CharacterID: 10001, Country: 2 }, { SeatID: 2, CharacterID: 10002, Country: 3 }] }),
    { context }
  );
  assert.equal(characters.type, "game:selectCharacter");
  assert.equal(characters.characters.length, 2);
  assert.equal(characters.characterId, 10001);

  const deal = parseProtocol("MsgGamePlayCardNtf", wrapper({ CardIDs: [11, 12], CardCount: 2 }), {
    context,
    cardInfo: (id) => ({ id, name: id === 11 ? "杀" : "闪", ncn: id === 11 ? "杀♠7" : "闪♥2" })
  });
  assert.equal(deal.type, "game:dealCards");
  assert.deepEqual(deal.cards.map((card) => card.id), [11, 12]);
  assert.equal(deal.count, 2);

  const ready = parseProtocol("GsCUserpreapreNtf", wrapper({ Infos: [{ SeatID: 1, Ready: true }, { SeatID: 2, Ready: false }] }), { context });
  assert.equal(ready.type, "player:ready");
  assert.deepEqual(ready.players.map((player) => player.ready), [true, false]);

  const leave = parseProtocol("ClientOtheruserLeavetableNtf", wrapper({ UserTempID: 99, SeatID: 7 }), { context });
  assert.equal(leave.type, "player:leave");
  assert.equal(leave.userTempId, 99);

  const stage = parseProtocol("MsgEnterGameStageNtf", wrapper({ Stage: 6 }), { context });
  assert.equal(stage.type, "game:stage");
  assert.equal(stage.stage, 6);

  const chat = parseProtocol("decodeSSCChatmsgNtf", wrapper({ Channel: 2, SpokerMan: 123, ChatMsg: "hello" }), { context });
  assert.equal(chat.type, "chat:message");
  assert.equal(chat.channel, "世界");
  assert.equal(chat.content, "hello");

  const over = parseProtocol("MsgGameOver", wrapper({}), { context });
  assert.equal(over.type, "game:over");
});

test("normalizes remaining old protocol list entries without generic fallback", () => {
  const context = createProtocolContext({ turn: 3, round: 1, phase: 2 });
  const samples = {
    MsgActionStateNtf: { action_id: 123, action_type: 2 },
    GsCFirstPhaseRole: {},
    decodeMsgCharacterSelectInfoNtf: { infos: [{ seatId: 1, characterId: 20001, country: 2 }] },
    ClientHappyGetFriendHandcardRep: {
      seatId: 3,
      cardList: [
        { cardId: 24, cardSuit: 2, cardSpellId: 2 },
        { cardId: 105, cardSuit: 1, cardSpellId: 11, cardSubType: 5 }
      ]
    },
    MsgNtfUseCardType: { type: 1, spellId: 83, destCnt: 1, usetype: 1, data: [1] },
    decodeSSCQuickChatmsgNtf: { Channel: 2, SpokerMan: 9, quickId: 12 }
  };

  const parsedByName = Object.fromEntries(Object.entries(samples).map(([name, data]) => [
    name,
    parseProtocol(name, wrapper(data), {
      context,
      cardInfo: (id) => ({ id, name: `card-${id}`, suit: "♠", rank: "7", ncn: `card-${id}♠7` }),
      skillRule: (id) => ({ id, name: `skill-${id}` })
    })
  ]));

  assert.equal(parsedByName.MsgActionStateNtf.type, "game:actionState");
  assert.equal(parsedByName.MsgActionStateNtf.actionId, 123);
  assert.equal(parsedByName.GsCFirstPhaseRole.type, "game:firstPhaseRole");
  assert.equal(parsedByName.decodeMsgCharacterSelectInfoNtf.type, "game:selectCharacter");
  assert.equal(parsedByName.decodeMsgCharacterSelectInfoNtf.characters[0].characterId, 20001);
  assert.equal(parsedByName.ClientHappyGetFriendHandcardRep.type, "hand:friendHandCards");
  assert.deepEqual(parsedByName.ClientHappyGetFriendHandcardRep.cards.map((card) => card.id), [24, 105]);
  assert.equal(parsedByName.ClientHappyGetFriendHandcardRep.cards[0].spellId, 2);
  assert.equal(parsedByName.MsgNtfUseCardType.type, "card:useType");
  assert.equal(parsedByName.MsgNtfUseCardType.skillRule.name, "skill-83");
  assert.equal(parsedByName.decodeSSCQuickChatmsgNtf.type, "chat:quickMessage");

  const covered = new Set([
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
    ...Object.keys(samples),
    "SmsgGameSetCharacter",
    "GsCGuoZhanSetCharacter",
    "MsgGamePlayCardNtf",
    "GsCRoleOptNtf",
    "GsCRoleOptTargetNtf",
    "CGsRoleSpellOptRep",
    "decodeSSCChatmsgNtf",
    "ClientOtheruserLeavetableNtf",
    "GsCUserpreapreNtf"
  ]);
  assert.deepEqual(OLD_PROTOCOLS.filter((name) => !covered.has(name)), []);
});

if (failed) {
  console.error(`\nProtocol normalizer core 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nProtocol normalizer core 测试: ${passed} 通过, ${failed} 失败`);

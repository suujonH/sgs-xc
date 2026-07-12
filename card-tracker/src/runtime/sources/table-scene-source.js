(() => {
  const root = window.__SgsScripts;
  const {
    buildSeatNames,
    findTableGameScene,
    readLogEntries
  } = root.utils;

  function seatIsDead(seat) {
    return seat?.isDead === true || seat?.IsDead === true;
  }

  function effectiveHandCount(scene, seat, selfSeat) {
    if (!seat || seatIsDead(seat)) return 0;
    const isSelf = seat === selfSeat;
    const publicCount = Number(seat.handCardCount || 0);
    const handCardsLength = Array.from(seat.handCards || []).length;
    if (isSelf && handCardsLength > 0) return handCardsLength;
    return publicCount;
  }

  function readGameMode(scene) {
    const candidates = {};
    addPrimitiveFields(candidates, "scene", scene, [
      "mode",
      "modeId",
      "model",
      "gameMode",
      "gameModel",
      "playMode",
      "roomMode",
      "roomType",
      "tableType",
      "ModeID",
      "ModeType",
      "RuleID",
      "RuleId",
      "RuleTypeID",
      "GroupID",
      "IsPaiwei"
    ]);
    addPrimitiveFields(candidates, "manager", scene?.manager, [
      "mode",
      "modeId",
      "model",
      "gameMode",
      "gameModel",
      "playMode",
      "roomMode",
      "roomType",
      "tableType",
      "ModeID",
      "ModeType",
      "RuleID",
      "RuleId",
      "RuleTypeID",
      "GroupID",
      "IsPaiwei"
    ]);
    addPrimitiveFields(candidates, "manager.roomInfo", scene?.manager?.roomInfo, [
      "mode",
      "modeId",
      "model",
      "gameMode",
      "gameModel",
      "roomMode",
      "roomType",
      "tableType",
      "ModeID",
      "ModeType",
      "RuleID",
      "RuleId",
      "RuleTypeID",
      "GroupID",
      "IsPaiwei"
    ]);
    addPrimitiveFields(candidates, "pveMgr", scene?.PveMgr || scene?.pveMgr, [
      "mode",
      "modeId",
      "model",
      "gameMode",
      "gameModel",
      "CurrentChapterNumber",
      "currentChapterNumber"
    ]);
    return {
      known: Object.keys(candidates).length > 0,
      candidates
    };
  }

  function readTableScene() {
    const scene = findTableGameScene();
    if (!scene) {
      return {
        ok: false,
        reason: "TableGameScene not visible",
        scene: null,
        seats: [],
        selfSeatIndex: -1,
        selfSeat: null,
        seatNames: [],
        mode: { known: false, candidates: {} },
        logs: []
      };
    }

    const managerSeats = Array.from(scene?.manager?.seats || []);
    const seats = managerSeats.filter((seat) => seat?.general);
    const rawSelfSeatIndex = Number(scene?.manager?.selfSeatIndex);
    const selfSeatIndex = Number.isInteger(rawSelfSeatIndex) ? rawSelfSeatIndex : managerSeats.findIndex((seat) => seat === scene?.SelfSeatUi?.seat);
    const selfSeat = selfSeatIndex >= 0 ? managerSeats[selfSeatIndex] : null;
    const { seatNames } = buildSeatNames(seats);
    const mode = readGameMode(scene);
    const seatRecords = seats.map((seat, seatIndex) =>
      readSeatRecord(scene, seat, seatIndex, managerSeats.indexOf(seat), selfSeat, seatNames[seatIndex] || [])
    );

    return {
      ok: true,
      scene,
      seats,
      managerSeats,
      selfSeatIndex,
      selfSeat,
      seatNames,
      seatRecords,
      mode,
      logs: readLogEntries(scene),
      visibility: seatRecords.map((seat) => ({
        seatIndex: seat.seatIndex,
        managerSeatIndex: seat.managerSeatIndex,
        names: seat.names,
        isSelf: seat.isSelf,
        isFriend: seat.relation.isFriend,
        isDead: seat.isDead,
        canViewHandCard: seat.canViewHandCard,
        handCardCount: seat.handCardCount,
        publicHandCardCount: seat.publicHandCardCount,
        handCardsLength: seat.handCardsLength,
        handShowCount: seat.handShowCount,
        watchCount: seat.watchCount
      }))
    };
  }

  function readSeatRecord(scene, seat, seatIndex, managerSeatIndex, selfSeat, names) {
    const isSelf = seat === selfSeat;
    return {
      seatIndex,
      managerSeatIndex,
      names,
      isSelf,
      isDead: seatIsDead(seat),
      canViewHandCard: seat?.canViewHandCard === true,
      handCardCount: effectiveHandCount(scene, seat, selfSeat),
      publicHandCardCount: Number(seat?.handCardCount || 0),
      handCardsLength: Array.from(seat?.handCards || []).length,
      handShowCount: Array.from(seat?.handShowCards || []).length,
      watchCount: Array.from(seat?.watchCards || []).length,
      relation: readSeatRelation(seat, isSelf),
      general: readGeneralInfo(seat?.general),
      player: readPlayerInfo(seat?.playerInfo)
    };
  }

  function readSeatRelation(seat, isSelf) {
    const relation = {
      isSelf,
      isFriend: booleanField(seat, ["isFriend", "isTeamMate", "isTeammate", "isPartner", "canAssist"]),
      isEnemy: booleanField(seat, ["isEnemy", "isOpponent"]),
      role: primitiveField(seat, ["role", "Role", "roleId", "RoleID"]),
      country: primitiveField(seat, ["country", "Country", "kingdom", "camp", "Camp"]),
      team: primitiveField(seat, ["team", "teamId", "TeamID", "campId", "CampID"])
    };
    if (relation.isSelf) relation.isFriend = true;
    return relation;
  }

  function readGeneralInfo(general) {
    if (!general) return null;
    return {
      id: primitiveField(general, ["id", "Id", "ID", "cardId", "CardID", "generalId", "GeneralID", "characterId", "CharacterID", "a"]),
      name: primitiveField(general, ["name", "Name", "cardName", "CardName", "specifyName", "SpecifyName", "b"]),
      code: primitiveField(general, ["code", "Code", "className", "ClassName", "d"]),
      specifyName: primitiveField(general, ["specifyName", "SpecifyName"]),
      trueSpecifyName: primitiveField(general, ["trueSpecifyName", "TrueSpecifyName"]),
      country: primitiveField(general, ["country", "Country", "kingdom", "camp", "Camp"]),
      raw: pickPrimitiveFields(general, [
        "id",
        "Id",
        "cardId",
        "generalId",
        "characterId",
        "cardName",
        "specifyName",
        "trueSpecifyName",
        "country",
        "kingdom",
        "camp"
      ])
    };
  }

  function readPlayerInfo(player) {
    if (!player) return null;
    return {
      userId: primitiveField(player, ["userId", "UserID", "uid", "Uid", "id", "Id"]),
      nickname: primitiveField(player, ["nickname", "nickName", "NickName", "name", "Name"]),
      raw: pickPrimitiveFields(player, [
        "userId",
        "uid",
        "id",
        "nickname",
        "nickName",
        "level",
        "vip",
        "sex"
      ])
    };
  }

  function addPrimitiveFields(target, prefix, source, fields) {
    if (!source) return;
    for (const field of fields) {
      const value = source[field];
      if (!isPrimitive(value)) continue;
      target[`${prefix}.${field}`] = value;
    }
  }

  function pickPrimitiveFields(source, fields) {
    const result = {};
    if (!source) return result;
    for (const field of fields) {
      const value = source[field];
      if (isPrimitive(value)) result[field] = value;
    }
    return result;
  }

  function primitiveField(source, fields) {
    if (!source) return null;
    for (const field of fields) {
      const value = source[field];
      if (isPrimitive(value)) return value;
    }
    return null;
  }

  function booleanField(source, fields) {
    if (!source) return false;
    for (const field of fields) {
      if (typeof source[field] === "boolean") return source[field];
    }
    return false;
  }

  function isPrimitive(value) {
    return value == null || ["string", "number", "boolean"].includes(typeof value);
  }

  Object.assign(root.sources, { readTableScene, seatIsDead, effectiveHandCount, readGameMode });
})();

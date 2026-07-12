const PUBLIC_ZONE_RULES = {
  equip: "public-equip-runtime",
  judge: "public-judge-runtime",
  general: "public-general-runtime",
  namedGeneral: "public-named-general-runtime"
};

const PUBLIC_ZONE_FLAT_FIELD_CANDIDATES = {
  equip: [
    "equipCards",
    "equipCardList",
    "equipmentCards",
    "equipList",
    "equips",
    "equipZoneCards",
    "equipZone"
  ],
  judge: [
    "judgeCards",
    "judgeCardList",
    "judgingCards",
    "judgeList",
    "judges",
    "delayCards",
    "delayCardList",
    "delayedTrickCards",
    "judgeZoneCards",
    "judgeZone"
  ],
  general: [
    "generalCards",
    "generalCardList",
    "publicGeneralCards"
  ]
};

// The first three names are older/generic mirrors. The skillOutSide* names are
// the current H5 seat stores used by AddSkillOutsideCards/GetSkillOutsideCards.
// They are keyed dictionaries, so their keys are card-zone identity rather than
// disposable container details.
const PUBLIC_NAMED_GENERAL_FIELD_CANDIDATES = [
  "generalPileCards",
  "markCards",
  "marksCards",
  "pileCards",
  "piles",
  "outsideCards",
  "skillOutSideCardDict",
  "skillOutsideCardDict",
  "skillOutSideCardDictByKeyId",
  "skillOutsideCardDictByKeyId"
];

const PUBLIC_ZONE_FIELD_CANDIDATES = {
  equip: PUBLIC_ZONE_FLAT_FIELD_CANDIDATES.equip,
  judge: PUBLIC_ZONE_FLAT_FIELD_CANDIDATES.judge,
  general: [
    ...PUBLIC_ZONE_FLAT_FIELD_CANDIDATES.general,
    ...PUBLIC_NAMED_GENERAL_FIELD_CANDIDATES
  ]
};

const CARD_COLLECTION_KEYS = ["cards", "Cards", "list", "items", "datum", "data"];

// Human-reviewed current SkillID semantics. A zero-ID H5 placeholder alone is
// not enough to decide whether an outside entry is a hidden physical card or a
// non-card marker/state. Unknown skills remain unresolved until semantic review
// or a positive physical CardID supplies stronger evidence.
const CONFIRMED_PHYSICAL_NAMED_ZONE_SKILL_IDS = new Set([
  123, 212, 219, 223, 228, 259, 290,
  438, 608,
  700, 715, 766, 812, 821, 827,
  913, 916, 942, 959,
  1511, 2116, 2127,
  3096, 3114, 3178,
  3389, 3476, 3532, 3601,
  3672, 3761, 3942, 3980, 3995, 4053,
  7028, 14023, 14112, 14181, 21006, 21110
]);

const CONFIRMED_NONPHYSICAL_OUTSIDE_ENTRY_SKILL_IDS = new Set([
  922, 923, 955,
  3042, 3122, 3142, 3220, 3228, 3242, 3252, 3297,
  3376, 3392, 3432,
  3650, 3784, 3824, 3839, 3964,
  11003
]);

function collectPublicZoneFacts(context = {}, options = {}) {
  const seats = Array.isArray(context.seats) ? context.seats : [];
  const seatNames = Array.isArray(context.seatNames) ? context.seatNames : [];
  const observationOptions = {
    ...options,
    observerSeat: finiteInteger(context.selfSeatIndex ?? options.observerSeat, -1)
  };
  const rows = seats.map((seat, seatIndex) => publicZoneRow(
    seat,
    seatIndex,
    seatNames[seatIndex] || [],
    observationOptions
  ));
  const allZones = rows.flatMap((row) => [
    ...Object.values(row.zones),
    ...(row.namedZones || [])
  ]);
  const physicalZones = allZones.filter(isPhysicalPublicZone);
  const allCards = allZones.flatMap((zone) => zone.cards || []);
  return {
    seats: rows,
    counts: {
      seats: rows.length,
      zones: physicalZones.filter((zone) => zone.count > 0).length,
      namedEntries: allZones.filter((zone) => zone.representationKind && zone.count > 0).length,
      cards: physicalZones.reduce((total, zone) => total + Number(zone.count || 0), 0),
      known: allCards.filter((card) => card.id != null).length,
      nonphysicalOutsideEntries: allZones.filter((zone) => zone.representationKind === "nonphysical-state")
        .reduce((total, zone) => total + Number(zone.count || 0), 0),
      unresolvedOutsideEntries: allZones.filter((zone) => zone.representationKind === "unresolved-outside-entry")
        .reduce((total, zone) => total + Number(zone.count || 0), 0),
      byZone: countBy(physicalZones, (zone) => zone.zoneName, (zone) => zone.count)
    },
    sources: countBy(allCards, (card) => card.source?.rule || "missing")
  };
}

function publicZoneRow(seat, seatIndex, names, options) {
  const zones = {};
  for (const zoneName of Object.keys(PUBLIC_ZONE_FLAT_FIELD_CANDIDATES)) {
    zones[zoneName] = collectSeatZone(seat, seatIndex, zoneName, options);
  }
  const namedZones = collectSeatNamedZones(seat, seatIndex, options);
  zones.general = excludeNamedPhysicalCards(zones.general, namedZones);
  const allZones = [...Object.values(zones), ...namedZones];
  const physicalZones = allZones.filter(isPhysicalPublicZone);
  const cards = allZones.flatMap((zone) => zone.cards || []);
  return {
    seatIndex,
    names,
    totalCount: physicalZones.reduce((total, zone) => total + Number(zone.count || 0), 0),
    outsideEntryCount: allZones.filter((zone) => zone.representationKind)
      .reduce((total, zone) => total + Number(zone.count || 0), 0),
    knownCount: cards.filter((card) => card.id != null).length,
    zones,
    namedZones
  };
}

function isPhysicalPublicZone(zone) {
  return !zone.representationKind || zone.representationKind === "physical-card-zone";
}

function collectSeatZone(seat, seatIndex, zoneName, options) {
  const seen = new Set();
  const cards = [];
  const fields = [];
  for (const fieldName of PUBLIC_ZONE_FLAT_FIELD_CANDIDATES[zoneName] || []) {
    if (!seat || !safeHas(seat, fieldName)) continue;
    const extracted = extractCards(safeGet(seat, fieldName), {
      zoneName,
      fieldName,
      seatIndex,
      options,
      seen,
      depth: 0
    });
    if (extracted.length) {
      fields.push(fieldName);
      cards.push(...extracted);
    }
  }
  return {
    zoneName,
    rule: PUBLIC_ZONE_RULES[zoneName] || "public-zone-runtime",
    fields,
    count: cards.length,
    knownCount: cards.filter((card) => card.id != null).length,
    cards
  };
}

function collectSeatNamedZones(seat, seatIndex, options) {
  const zones = [];
  for (const fieldName of PUBLIC_NAMED_GENERAL_FIELD_CANDIDATES) {
    if (!seat || !safeHas(seat, fieldName)) continue;
    const fieldValue = safeGet(seat, fieldName);
    const parameterDictionary = /skilloutsidecarddict$/i.test(fieldName)
      ? safeGet(seat, "skillOutSideCardParamDict") ?? safeGet(seat, "skillOutsideCardParamDict")
      : null;
    zones.push(...collectNamedZoneEntries(fieldValue, {
      fieldName,
      seatIndex,
      options,
      path: [],
      depth: 0,
      parameterDictionary
    }));
  }
  return mergeSameNamedZones(zones);
}

function collectNamedZoneEntries(value, context) {
  if (value == null || context.depth > 5) return [];

  const dictionary = keyedEntries(value);
  if (dictionary.length) {
    return dictionary.flatMap(([key, entryValue]) => collectNamedZoneEntries(entryValue, {
      ...context,
      path: [...context.path, identityText(key)],
      identityKey: key,
      depth: context.depth + 1
    }));
  }

  if (isCollection(value)) {
    const values = Array.from(value);
    if (values.length && values.every(isNamedZoneDescriptor)) {
      return values.flatMap((item, index) => collectNamedZoneEntries(item, {
        ...context,
        path: [...context.path, String(index)],
        identityKey: index,
        depth: context.depth + 1
      }));
    }
    return [namedZoneRow(value, context)];
  }

  if (isNamedZoneDescriptor(value)) {
    const nestedValue = firstDefined(value, CARD_COLLECTION_KEYS);
    return [namedZoneRow(nestedValue, { ...context, descriptor: value })];
  }

  if (looksLikeCard(value) || Number.isFinite(Number(value))) {
    return [namedZoneRow([value], context)];
  }

  return [];
}

function namedZoneRow(value, context) {
  const descriptor = context.descriptor || (value && !isCollection(value) && typeof value === "object" ? value : null);
  const rawItems = isCollection(value) ? Array.from(value) : value == null ? [] : [value];
  const path = context.path.length ? context.path : [context.fieldName];
  const rawKey = firstDefined(descriptor, [
    "pileKey", "pileName", "PileKey", "PileName", "skillKey", "SkillKey", "key", "Key", "name", "Name"
  ]) ?? context.identityKey ?? path[path.length - 1] ?? context.fieldName;
  const pileKey = identityText(rawKey) || `${context.fieldName}:${path.join("/")}`;
  const dictionarySkillStore = /skilloutsidecarddict/i.test(context.fieldName);
  const numericKey = positiveInteger(context.identityKey ?? rawKey);
  const explicitZoneParam = firstDefined(descriptor, [
    "zoneParam", "ZoneParam", "toZoneParam", "ToZoneParam", "fromZoneParam", "FromZoneParam"
  ]);
  const zoneParam = explicitZoneParam !== undefined
    ? jsonSafe(explicitZoneParam)
    : dictionarySkillStore && numericKey > 0
      ? numericKey
      : null;
  const explicitSkillId = positiveInteger(firstDefined(descriptor, [
    "skillId", "SkillID", "skillID", "spellId", "SpellID", "spellID"
  ]));
  const skillId = explicitSkillId || (dictionarySkillStore ? numericKey : 0) || null;
  const metadata = zoneMetadata(descriptor);
  const parameterValue = dictionarySkillStore && numericKey > 0
    ? dictionaryValue(context.parameterDictionary, numericKey)
    : undefined;
  if (parameterValue !== undefined) metadata.outsideCardParams = jsonSafe(parameterValue);

  const faceUp = faceUpValue(descriptor);
  const visibilityAudience = visibilityValue(descriptor, faceUp);
  const observerSeats = uniqueFiniteIntegers([
    ...asList(firstDefined(descriptor, ["observerSeats", "viewerSeats", "visibleToSeats", "authorizedSeats"])),
    ...(context.options?.observerSeat >= 0 && rawItems.length ? [context.options.observerSeat] : [])
  ]);
  const orderedValue = firstDefined(descriptor, ["ordered", "isOrdered", "orderKnown"]);
  const ordered = orderedValue === true || firstDefined(descriptor, ["preserveOrder", "PreserveOrder"]) === true;
  const orderKnown = firstDefined(descriptor, ["orderKnown", "OrderKnown"]) === true || orderedValue === true;
  const explicitCount = nonNegativeInteger(firstDefined(descriptor, [
    "count", "Count", "cardCount", "CardCount", "outsideCardCount", "OutsideCardCount"
  ]));

  const seen = new Set();
  const cards = extractCards(rawItems, {
    zoneName: "general",
    fieldName: context.fieldName,
    seatIndex: context.seatIndex,
    options: context.options,
    seen,
    depth: 0,
    pileKey,
    zonePath: [context.fieldName, ...path]
  });
  const cardIds = uniquePositiveIds(cards.map((card) => card.id));
  const count = Math.max(explicitCount ?? rawItems.length, cardIds.length);
  const complete = count === cardIds.length && cards.every((card) => card.id != null);
  const representationKind = namedZoneRepresentationKind({
    skillId,
    pileKey,
    cardIds,
    count,
    descriptor,
    options: context.options
  });
  const cardStates = Object.fromEntries(cardIds.map((cardId) => [cardId, {
    faceUp,
    visibilityAudience,
    observerSeats,
    metadata: {}
  }]));
  const ownerValue = firstDefinedWithPresence(descriptor, ["ownerSeat", "OwnerSeat", "owner", "Owner"]);
  const controllerSeat = nullableInteger(firstDefined(descriptor, ["controllerSeat", "ControllerSeat"]));
  const placedBySeat = nullableInteger(firstDefined(descriptor, ["placedBySeat", "PlacedBySeat", "srcSeat", "SrcSeatID"]));
  const hostGeneralId = nullableInteger(firstDefined(descriptor, ["hostGeneralId", "HostGeneralID", "generalId", "GeneralID"]));
  const hostCardId = nullableInteger(firstDefined(descriptor, ["hostCardId", "HostCardID", "equipmentCardId", "EquipmentCardID"]));
  const attachmentPolicy = String(firstDefined(descriptor, ["attachmentPolicy", "AttachmentPolicy"]) || "").trim() || null;
  const capacity = nonNegativeInteger(firstDefined(descriptor, ["capacity", "Capacity", "maxCount", "MaxCount"]));
  const zoneKind = String(firstDefined(descriptor, ["zoneKind", "ZoneKind"]) || "removed");
  const ruleIdentityKey = String(firstDefined(descriptor, ["ruleIdentityKey", "RuleIdentityKey"]) || [
    context.fieldName,
    pileKey,
    zoneParam ?? ""
  ].join(":"));

  return {
    zoneName: "general",
    zoneKind,
    pileKey,
    zoneParam,
    skillId,
    ruleIdentityKey,
    hostSeat: context.seatIndex,
    hostArea: String(firstDefined(descriptor, ["hostArea", "HostArea"]) || "general-card"),
    hostGeneralId,
    hostCardId,
    attachmentPolicy,
    capacity,
    controllerSeat,
    placedBySeat,
    ownerSeat: ownerValue.present ? nullableInteger(ownerValue.value) : null,
    // Cards placed on a general are explicitly outside every player's owned
    // zones even when the runtime descriptor omits an owner field.
    ownershipKnown: true,
    ordered,
    orderKnown,
    faceUp,
    visibilityAudience,
    observerSeats,
    count,
    knownCount: cardIds.length,
    cardIds,
    complete,
    representationKind,
    cardStates,
    cards,
    fields: [context.fieldName],
    fieldName: context.fieldName,
    path: [context.fieldName, ...path],
    metadata,
    rule: PUBLIC_ZONE_RULES.namedGeneral,
    source: {
      rule: PUBLIC_ZONE_RULES.namedGeneral,
      sourceKind: "public-zone",
      origin: "runtime-public-named-field",
      seatIndex: context.seatIndex,
      zoneName: "general",
      fieldName: context.fieldName,
      path: [context.fieldName, ...path],
      pileKey,
      zoneParam,
      skillId
    }
  };
}

function namedZoneRepresentationKind(input) {
  if (input.cardIds.length > 0) return "physical-card-zone";
  const explicit = firstDefined(input.descriptor, ["representationKind", "RepresentationKind", "entityKind", "EntityKind"]);
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  if (typeof input.options?.namedZoneRepresentation === "function") {
    const resolved = input.options.namedZoneRepresentation({
      skillId: input.skillId,
      pileKey: input.pileKey,
      count: input.count
    });
    if (resolved) return String(resolved);
  }
  if (CONFIRMED_PHYSICAL_NAMED_ZONE_SKILL_IDS.has(Number(input.skillId))) return "physical-card-zone";
  if (CONFIRMED_NONPHYSICAL_OUTSIDE_ENTRY_SKILL_IDS.has(Number(input.skillId))) return "nonphysical-state";
  return "unresolved-outside-entry";
}

function mergeSameNamedZones(zones) {
  const merged = new Map();
  for (const zone of zones) {
    const key = canonicalJson({
      zoneKind: zone.zoneKind,
      hostSeat: zone.hostSeat,
      pileKey: zone.pileKey,
      zoneParam: zone.zoneParam,
      skillId: zone.skillId,
      ruleIdentityKey: zone.ruleIdentityKey
    });
    const current = merged.get(key);
    if (!current) {
      merged.set(key, zone);
      continue;
    }
    const cards = dedupeCards([...(current.cards || []), ...(zone.cards || [])]);
    const cardIds = uniquePositiveIds(cards.map((card) => card.id));
    current.cards = cards;
    current.cardIds = cardIds;
    current.knownCount = cardIds.length;
    current.count = Math.max(current.count, zone.count, cardIds.length);
    current.complete = current.complete && zone.complete && current.count === cardIds.length;
    current.representationKind = strongerRepresentationKind(current.representationKind, zone.representationKind);
    current.fields = Array.from(new Set([...(current.fields || []), ...(zone.fields || [])]));
    current.cardStates = { ...current.cardStates, ...zone.cardStates };
  }
  return Array.from(merged.values()).sort((left, right) =>
    canonicalJson([left.hostSeat, left.pileKey, left.zoneParam]).localeCompare(
      canonicalJson([right.hostSeat, right.pileKey, right.zoneParam])
    )
  );
}

function strongerRepresentationKind(left, right) {
  const rank = {
    "unresolved-outside-entry": 0,
    "nonphysical-state": 1,
    "physical-card-zone": 2
  };
  return (rank[right] ?? 0) > (rank[left] ?? 0) ? right : left;
}

function excludeNamedPhysicalCards(zone, namedZones) {
  const namedIds = new Set(namedZones.flatMap((row) => row.cardIds || []));
  if (!namedIds.size) return zone;
  const cards = (zone.cards || []).filter((card) => card.id == null || !namedIds.has(card.id));
  return {
    ...zone,
    count: cards.length,
    knownCount: cards.filter((card) => card.id != null).length,
    cards
  };
}

function extractCards(value, context) {
  if (value == null || context.depth > 4) return [];
  if (isCollection(value)) {
    return Array.from(value).flatMap((item, index) => extractCards(item, {
      ...context,
      cardIndex: index,
      depth: context.depth + 1
    }));
  }
  if (value instanceof Map) {
    return Array.from(value.entries()).flatMap(([key, item], index) => extractCards(item, {
      ...context,
      mapKey: identityText(key),
      cardIndex: index,
      depth: context.depth + 1
    }));
  }
  const direct = normalizePublicCard(value, context);
  if (direct) return [direct];
  const nested = [];
  for (const key of ["card", "Card", "data", "vo", "info", "item", "value", "cards", "Cards", "list", "items"]) {
    if (value && typeof value === "object" && safeHas(value, key)) {
      nested.push(...extractCards(safeGet(value, key), {
        ...context,
        depth: context.depth + 1
      }));
    }
  }
  return nested;
}

function normalizePublicCard(value, context) {
  const options = context.options || {};
  const raw = value?.Card || value?.card || value;
  let normalized = typeof options.runtimeCard === "function" ? options.runtimeCard(raw) : fallbackRuntimeCard(raw);
  if (!normalized && Number.isFinite(Number(raw))) normalized = cardFromInfo(Number(raw), options);
  if (!normalized) return null;
  const numericId = Number(normalized.id);
  const id = Number.isInteger(numericId) && numericId > 0 ? numericId : null;
  const info = id ? cardInfo(id, options) : {};
  const card = {
    id,
    name: normalized.name || info.name || "",
    suit: normalized.suit || info.suit || "",
    rank: normalized.rank || info.rank || "",
    color: normalized.color || info.color || "",
    text: normalized.text || info.ncn || joinCardText(normalized, info)
  };
  if (card.id == null && !card.text) return null;
  const key = card.id != null
    ? `${context.zoneName}:id:${card.id}`
    : `${context.zoneName}:text:${card.text}:${context.fieldName}:${context.cardIndex ?? ""}`;
  if (context.seen.has(key)) return null;
  context.seen.add(key);
  return {
    ...card,
    source: {
      rule: context.pileKey ? PUBLIC_ZONE_RULES.namedGeneral : PUBLIC_ZONE_RULES[context.zoneName] || "public-zone-runtime",
      sourceKind: "public-zone",
      origin: context.pileKey ? "runtime-public-named-field" : "runtime-public-field",
      seatIndex: context.seatIndex,
      zoneName: context.zoneName,
      fieldName: context.fieldName,
      pileKey: context.pileKey || null,
      mapKey: context.mapKey ?? null,
      path: context.zonePath || null,
      cardIndex: context.cardIndex ?? null
    }
  };
}

function fallbackRuntimeCard(card) {
  if (!card || typeof card !== "object") return null;
  const id = card.cardId ?? card.CardId ?? card.cardID ?? card.CardID ?? card.id ?? card.Id;
  const name = card.cardName || card.CardName || card.name || card.Name || "";
  const suit = suitText(card.cardFlower ?? card.CardFlower ?? card.suit ?? card.Suit);
  const rawRank = card.cardNumber ?? card.cardNumberOri ?? card.Number ?? card.number ?? card.rank;
  const rank = rankText(rawRank);
  const text = card.text || card.ncn || joinCardText({ name, suit, rank }, {});
  if (id == null && !text) return null;
  return { id, name, suit, rank, text, color: colorName(suit) };
}

function cardFromInfo(id, options) {
  const info = cardInfo(id, options);
  if (!info || !Object.keys(info).length) return { id };
  return {
    id,
    name: info.name || "",
    suit: info.suit || "",
    rank: info.rank || "",
    text: info.ncn || joinCardText({}, info),
    color: info.color || colorName(info.suit)
  };
}

function cardInfo(id, options) {
  if (typeof options.cardInfo === "function") return options.cardInfo(id) || {};
  return options.cardDict?.[id] || {};
}

function keyedEntries(value) {
  if (!value || typeof value !== "object" || isCollection(value) || looksLikeCard(value)) return [];
  if (value instanceof Map) return Array.from(value.entries());

  const elements = safeGet(value, "elements");
  if (Array.isArray(elements) && elements.every((row) => row && typeof row === "object" && safeHas(row, "key"))) {
    return elements.map((row) => [safeGet(row, "key"), safeGet(row, "data")]);
  }

  for (const field of ["Maps", "_maps"]) {
    const maps = safeGet(value, field);
    if (maps && typeof maps === "object" && !Array.isArray(maps)) return Object.entries(maps);
  }

  const keys = safeGet(value, "keys");
  const datum = safeGet(value, "datum");
  if (Array.isArray(keys) && Array.isArray(datum) && keys.length === datum.length) {
    return keys.map((key, index) => [key, datum[index]]);
  }

  if (isNamedZoneDescriptor(value)) return [];
  if (isPlainObject(value)) {
    return Object.entries(value).filter(([key]) => !key.startsWith("_") && !DESCRIPTOR_KEYS.has(key));
  }
  return [];
}

const DESCRIPTOR_KEYS = new Set([
  ...CARD_COLLECTION_KEYS,
  "pileKey", "pileName", "PileKey", "PileName", "skillKey", "SkillKey", "key", "Key", "name", "Name",
  "zoneParam", "ZoneParam", "toZoneParam", "ToZoneParam", "fromZoneParam", "FromZoneParam",
  "skillId", "SkillID", "skillID", "spellId", "SpellID", "spellID",
  "count", "Count", "cardCount", "CardCount", "ordered", "orderKnown", "faceUp", "visibilityAudience"
]);

function isNamedZoneDescriptor(value) {
  if (!value || typeof value !== "object" || isCollection(value) || looksLikeCard(value)) return false;
  return CARD_COLLECTION_KEYS.some((key) => safeHas(value, key));
}

function looksLikeCard(value) {
  if (!value || typeof value !== "object") return false;
  const raw = safeGet(value, "Card") || safeGet(value, "card") || value;
  return ["cardId", "CardId", "cardID", "CardID", "id", "Id", "cardName", "CardName", "cardFlower", "CardFlower"]
    .some((key) => safeHas(raw, key));
}

function dictionaryValue(dictionary, key) {
  if (!dictionary) return undefined;
  const entries = keyedEntries(dictionary);
  const found = entries.find(([entryKey]) => String(entryKey) === String(key));
  return found ? found[1] : undefined;
}

function faceUpValue(descriptor) {
  const explicit = firstDefined(descriptor, ["faceUp", "FaceUp", "isFaceUp", "IsFaceUp"]);
  if (explicit != null) return explicit === true;
  const hidden = firstDefined(descriptor, ["hidden", "Hidden", "isHidden", "IsHidden", "faceDown", "FaceDown"]);
  if (hidden != null) return hidden !== true;
  const shown = firstDefined(descriptor, ["needShowOutsideCardOnSeat", "NeedShowOutsideCardOnSeat", "isPublic", "IsPublic"]);
  return shown == null ? null : shown === true;
}

function visibilityValue(descriptor, faceUp) {
  const explicit = firstDefined(descriptor, ["visibilityAudience", "VisibilityAudience", "visibility", "Visibility"]);
  if (explicit != null && String(explicit).trim()) return String(explicit);
  const isPublic = firstDefined(descriptor, ["isPublic", "IsPublic", "needShowOutsideCardOnSeat", "NeedShowOutsideCardOnSeat"]);
  if (isPublic === true || faceUp === true) return "public";
  if (isPublic === false || faceUp === false) return "restricted";
  return "runtime-observed";
}

function zoneMetadata(descriptor) {
  const metadata = firstDefined(descriptor, ["metadata", "Metadata"]);
  return metadata && typeof metadata === "object" ? jsonSafe(metadata) : {};
}

function firstDefined(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    if (!safeHas(value, key)) continue;
    const result = safeGet(value, key);
    if (result !== undefined) return result;
  }
  return undefined;
}

function firstDefinedWithPresence(value, keys) {
  if (!value || typeof value !== "object") return { present: false, value: undefined };
  for (const key of keys) {
    if (!safeHas(value, key)) continue;
    return { present: true, value: safeGet(value, key) };
  }
  return { present: false, value: undefined };
}

function safeHas(value, key) {
  try {
    return value != null && key in Object(value);
  } catch {
    return false;
  }
}

function safeGet(value, key) {
  try {
    return value == null ? undefined : value[key];
  } catch {
    return undefined;
  }
}

function isCollection(value) {
  return Array.isArray(value) || value instanceof Set;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asList(value) {
  if (value == null) return [];
  if (Array.isArray(value) || value instanceof Set) return Array.from(value);
  return [value];
}

function identityText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return canonicalJson(jsonSafe(value));
}

function jsonSafe(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function dedupeCards(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    const key = card.id != null ? `id:${card.id}` : `text:${card.text}:${canonicalJson(card.source || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniquePositiveIds(values) {
  return Array.from(new Set((values || []).map(Number).filter((value) => Number.isInteger(value) && value > 0)));
}

function uniqueFiniteIntegers(values) {
  return Array.from(new Set((values || []).map(Number).filter(Number.isInteger))).sort((left, right) => left - right);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function nullableInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function finiteInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function suitText(value) {
  const map = { 1: "♥", 2: "♦", 3: "♠", 4: "♣" };
  return map[value] || String(value || "");
}

function rankText(value) {
  const map = { 1: "A", 11: "J", 12: "Q", 13: "K" };
  return map[value] || (value == null || value === "" ? "" : String(value));
}

function colorName(suit) {
  if (suit === "♥" || suit === "♦") return "red";
  if (suit === "♠" || suit === "♣") return "black";
  return "";
}

function joinCardText(card, info) {
  return `${card.name || info.name || ""}${card.suit || info.suit || ""}${card.rank || info.rank || ""}`;
}

function countBy(items, keyFn, valueFn = () => 1) {
  const result = {};
  for (const item of items || []) {
    const key = keyFn(item) || "missing";
    result[key] = (result[key] || 0) + Number(valueFn(item) || 0);
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

module.exports = {
  collectPublicZoneFacts,
  PUBLIC_ZONE_FIELD_CANDIDATES,
  PUBLIC_ZONE_FLAT_FIELD_CANDIDATES,
  PUBLIC_NAMED_GENERAL_FIELD_CANDIDATES,
  CONFIRMED_PHYSICAL_NAMED_ZONE_SKILL_IDS,
  CONFIRMED_NONPHYSICAL_OUTSIDE_ENTRY_SKILL_IDS,
  PUBLIC_ZONE_RULES
};

const PUBLIC_ZONE_NAMES = ["equip", "judge", "general"];
function buildPublicZoneReport(value, validation = null) {
  const snapshot = value?.snapshot || (value?.config || value?.protocol ? value : null);
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      error: "snapshot object is missing"
    };
  }

  const publicZones = snapshot.publicZones || null;
  const seats = Array.isArray(publicZones?.seats) ? publicZones.seats : [];
  const zoneRows = flattenPublicZones(seats);
  const cards = flattenPublicCards(seats);
  const sourceProblems = cards.filter((item) => !isPublicZoneSource(item.card?.source)).map(problemForCard);

  return {
    ok: true,
    visible: snapshot.visible === true,
    reason: snapshot.reason || "",
    table: {
      visibilityRows: Array.isArray(snapshot.visibility) ? snapshot.visibility.length : 0,
      logRows: Array.isArray(snapshot.logs) ? snapshot.logs.length : 0
    },
    counts: {
      seats: seats.length,
      zones: zoneRows.filter((row) => Number(row.zone?.count || 0) > 0).length,
      namedEntries: zoneRows.filter((row) => row.named && Number(row.zone?.count || 0) > 0).length,
      cards: zoneRows.reduce((total, row) => total + Number(row.zone?.count || 0), 0),
      known: cards.filter((item) => item.card?.id != null).length,
      nonphysicalOutsideEntries: seats.flatMap((seat) => seat.namedZones || [])
        .filter((zone) => zone.representationKind === "nonphysical-state")
        .reduce((total, zone) => total + Number(zone.count || 0), 0),
      unresolvedOutsideEntries: seats.flatMap((seat) => seat.namedZones || [])
        .filter((zone) => zone.representationKind === "unresolved-outside-entry")
        .reduce((total, zone) => total + Number(zone.count || 0), 0),
      byZone: countZoneRows(zoneRows),
      byRule: countBy(cards, (item) => item.card?.source?.rule || "missing")
    },
    provenance: {
      publicZonesCheck: checkStatus(validation, "publicZones.present"),
      sourcesCheck: checkStatus(validation, "publicZones.sources"),
      problems: sourceProblems,
      examples: cards.slice(0, 12).map(exampleForCard)
    },
    seats: seats.map(reportSeat)
  };
}

function flattenPublicCards(seats) {
  const result = [];
  for (const seat of seats || []) {
    for (const zoneName of PUBLIC_ZONE_NAMES) {
      const zone = seat?.zones?.[zoneName] || {};
      for (const card of zone.cards || []) {
        result.push({
          seatIndex: seat.seatIndex,
          names: seat.names || [],
          zoneName,
          zone,
          card
        });
      }
    }
    for (const zone of seat?.namedZones || []) {
      if (zone.representationKind && zone.representationKind !== "physical-card-zone") continue;
      for (const card of zone.cards || []) {
        result.push({
          seatIndex: seat.seatIndex,
          names: seat.names || [],
          zoneName: zone.zoneName || "general",
          zone,
          named: true,
          card
        });
      }
    }
  }
  return result;
}

function flattenPublicZones(seats) {
  const result = [];
  for (const seat of seats || []) {
    for (const zoneName of PUBLIC_ZONE_NAMES) {
      const zone = seat?.zones?.[zoneName] || null;
      if (zone) result.push({ seatIndex: seat.seatIndex, zoneName, zone, named: false });
    }
    for (const zone of seat?.namedZones || []) {
      if (zone.representationKind && zone.representationKind !== "physical-card-zone") continue;
      result.push({ seatIndex: seat.seatIndex, zoneName: zone.zoneName || "general", zone, named: true });
    }
  }
  return result;
}

function reportSeat(seat) {
  return {
    seatIndex: seat.seatIndex,
    names: seat.names || [],
    totalCount: Number(seat.totalCount || 0),
    knownCount: Number(seat.knownCount || 0),
    zones: Object.fromEntries(PUBLIC_ZONE_NAMES.map((zoneName) => {
      const zone = seat?.zones?.[zoneName] || {};
      return [zoneName, {
        count: Number(zone.count || 0),
        knownCount: Number(zone.knownCount || 0),
        fields: zone.fields || [],
        cards: (zone.cards || []).map((card) => ({
          id: card?.id ?? null,
          text: card?.text || "",
          rule: card?.source?.rule || "",
          fieldName: card?.source?.fieldName || "",
          cardIndex: card?.source?.cardIndex ?? null
        }))
      }];
    })),
    namedZones: (seat.namedZones || []).map((zone) => ({
      zoneKind: zone.zoneKind || "",
      pileKey: zone.pileKey || "",
      zoneParam: zone.zoneParam ?? null,
      skillId: zone.skillId ?? null,
      representationKind: zone.representationKind || "physical-card-zone",
      count: Number(zone.count || 0),
      knownCount: Number(zone.knownCount || zone.cardIds?.length || 0),
      complete: zone.complete === true,
      orderKnown: zone.orderKnown === true,
      faceUp: zone.faceUp ?? null,
      visibilityAudience: zone.visibilityAudience || "unknown",
      cards: (zone.cards || []).map((card) => ({
        id: card?.id ?? null,
        text: card?.text || "",
        rule: card?.source?.rule || "",
        fieldName: card?.source?.fieldName || "",
        cardIndex: card?.source?.cardIndex ?? null
      }))
    }))
  };
}

function isPublicZoneSource(source) {
  if (!source) return false;
  const named = source.rule === "public-named-general-runtime" && source.origin === "runtime-public-named-field";
  return (
    (named || ["public-equip-runtime", "public-judge-runtime", "public-general-runtime"].includes(source.rule)) &&
    source.sourceKind === "public-zone" &&
    (named || source.origin === "runtime-public-field") &&
    !!source.zoneName &&
    !!source.fieldName &&
    Number.isInteger(Number(source.seatIndex))
  );
}

function problemForCard(item) {
  const source = item.card?.source || {};
  return {
    seatIndex: item.seatIndex,
    zoneName: item.zoneName,
    id: item.card?.id ?? null,
    text: item.card?.text || "",
    rule: source.rule || "",
    missing: missingPublicZoneFields(source)
  };
}

function missingPublicZoneFields(source) {
  const missing = [];
  const named = source?.rule === "public-named-general-runtime" && source?.origin === "runtime-public-named-field";
  if (!named && !["public-equip-runtime", "public-judge-runtime", "public-general-runtime"].includes(source?.rule)) missing.push("rule");
  if (source?.sourceKind !== "public-zone") missing.push("sourceKind");
  if (!named && source?.origin !== "runtime-public-field") missing.push("origin");
  if (!source?.zoneName) missing.push("zoneName");
  if (!source?.fieldName) missing.push("fieldName");
  if (!Number.isInteger(Number(source?.seatIndex))) missing.push("seatIndex");
  return missing;
}

function exampleForCard(item) {
  const source = item.card?.source || {};
  return {
    seatIndex: item.seatIndex,
    zoneName: item.zoneName,
    id: item.card?.id ?? null,
    text: item.card?.text || "",
    rule: source.rule || "",
    fieldName: source.fieldName || "",
    cardIndex: source.cardIndex ?? null
  };
}

function checkStatus(validation, id) {
  const check = validation?.checks?.find?.((item) => item.id === id);
  if (!check) return null;
  return {
    status: check.status,
    message: check.message,
    actual: check.actual
  };
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items || []) {
    const key = keyFn(item) || "missing";
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function countZoneRows(rows) {
  const result = {};
  for (const row of rows || []) {
    result[row.zoneName || "missing"] = (result[row.zoneName || "missing"] || 0) + Number(row.zone?.count || 0);
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

module.exports = {
  buildPublicZoneReport,
  isPublicZoneSource
};

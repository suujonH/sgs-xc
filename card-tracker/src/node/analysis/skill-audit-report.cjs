function buildMissingGeneralSkillRefReport(refs = {}) {
  const rows = array(refs).map(missingGeneralSkillRefRow);
  const placeholderRows = rows.filter((row) => row.placeholderCandidate === true).length;
  const unresolvedRows = rows.length - placeholderRows;
  return {
    ok: true,
    counts: {
      total: rows.length,
      unresolved: unresolvedRows,
      placeholderCandidates: placeholderRows,
      withSpellExtendRows: rows.filter((row) => row.hasSpellExtendRows === true).length,
      playCardSpellIds: rows.filter((row) => row.isPlayCardSpell === true).length
    },
    byGeneral: countBy(rows, (row) => `${row.generalId}:${row.generalName || row.className}`),
    bySkillId: countBy(rows, (row) => String(row.skillId || "")),
    rows
  };
}

function missingGeneralSkillRefRow(ref) {
  const generalName = stringValue(ref?.generalName);
  const className = stringValue(ref?.className);
  const skillId = numberValue(ref?.skillId);
  const placeholderCandidate = isPlaceholderCandidate({ generalId: ref?.generalId, generalName, className, skillId });
  return {
    generalId: numberValue(ref?.generalId),
    generalName,
    className,
    slot: stringValue(ref?.slot),
    skillId,
    presentInChaSpell: false,
    hasSpellExtendRows: ref?.hasSpellExtendRows === true,
    isPlayCardSpell: ref?.isPlayCardSpell === true,
    placeholderCandidate,
    reviewStatus: placeholderCandidate ? "placeholder-candidate" : "needs-config-confirmation",
    trackerDecision: "no-card-fact-without-cha-spell",
    reason: "character skill slot references an id that is not present in cha_spell.sgs"
  };
}

function isPlaceholderCandidate(ref) {
  const name = `${stringValue(ref.generalName)} ${stringValue(ref.className)}`.toLowerCase();
  return numberValue(ref.generalId) >= 9999 || numberValue(ref.skillId) >= 99999 || /shenmi|神秘|placeholder|unknown/.test(name);
}

function countBy(rows, getKey) {
  const out = {};
  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value) {
  return String(value == null ? "" : value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildMissingGeneralSkillRefReport
};

(() => {
  const root = window.__SgsScripts;
  const configTableCore = root.modules.configTableCore;
  const skillRuleCore = root.modules.skillRuleCore;
  const candidateRuleCore = root.modules.candidateRuleCore;
  const {
    tableRows,
    skillIdFromRow,
    skillName,
    skillDesc,
    cardSpellId,
    buildCardDict,
    buildGameRuleDecks,
    buildSpellDict,
    rowSearchText,
    buildSkillOwners,
    buildSkillExtends,
    sourceTypeFor
  } = configTableCore;

  const state = {
    loaded: false,
    loading: false,
    error: "",
    attempts: 0,
    lastAttemptAt: 0,
    sourceUrl: "",
    version: 0,
    cardCount: 0,
    spellCount: 0,
    markSpellCount: 0,
    cardIDsOrder: [],
    standardDeckIds: [],
    gameRuleDecks: {},
    cardDict: {},
    spellDict: {},
    markSpell: {},
    skillRules: {},
    skillRuleSummary: null
  };

  let loadPromise = null;

  function buildSkillRuleIndex(spellRows, characterRows, cardRows, spellExtendRows) {
    const { realGeneralRows, skillOwners } = buildSkillOwners(characterRows);
    const skillExtends = buildSkillExtends(spellExtendRows);
    const cardSpellIds = new Set(cardRows.map(cardSpellId).filter(Boolean));
    const skills = {};

    for (const row of spellRows) {
      const id = skillIdFromRow(row);
      if (!id) continue;
      const name = skillName(row);
      const desc = skillDesc(row);
      const extensions = skillExtends.get(id) || [];
      const text = `${name} ${desc} ${extensions.map(rowSearchText).join(" ")}`;
      const categories = skillRuleCore.categoriesForText(text, { includeLabel: false });
      const categoryIds = categories.map((item) => item.id);
      const owners = skillOwners.get(id) || [];
      const candidateRules = candidateRuleCore.candidateRulesForText(text, { skillId: id, skillName: name });
      skills[id] = {
        id,
        name,
        desc,
        sourceType: sourceTypeFor(id, owners, cardSpellIds),
        owners: owners.map((owner) => ({ generalId: owner.generalId, name: owner.name, slots: owner.slots })),
        isPlayCardSpell: cardSpellIds.has(id),
        extensionCount: extensions.length,
        categories,
        actions: Array.from(new Set(categories.map((item) => item.action))),
        priority: skillRuleCore.priorityOf(categoryIds),
        confidence: skillRuleCore.confidenceOf(categories),
        candidateRules
      };
    }

    const rows = Object.values(skills);
    const orderSourceSensitive = rows.filter((skill) => skill.confidence === "manual-order-or-source-required").length;
    const candidateRules = rows.flatMap((skill) => skill.candidateRules || []);
    return {
      skills,
      summary: {
        totalSkills: rows.length,
        realGeneralRows: realGeneralRows.length,
        playCardSpellIds: cardSpellIds.size,
        spellExtendRows: spellExtendRows.length,
        trackerRelevant: rows.filter((skill) => skill.priority === "tracker-relevant").length,
        supporting: rows.filter((skill) => skill.priority === "supporting").length,
        none: rows.filter((skill) => skill.priority === "none").length,
        orderSourceSensitive,
        manualReview: orderSourceSensitive,
        skillTextCandidateRuleSkills: rows.filter((skill) => skill.candidateRules?.length).length,
        skillTextCandidateRules: candidateRules.length,
        candidateRuleFields: skillRuleCore.countBy(candidateRules.flatMap((rule) => rule.constraints || []), (constraint) => constraint.field || "unknown"),
        sourceTypeCounts: skillRuleCore.countBy(rows, (skill) => skill.sourceType),
        categoryCounts: skillRuleCore.countBy(rows, (skill) => skill.categories.map((item) => item.id)),
        confidenceCounts: skillRuleCore.countBy(rows, (skill) => skill.confidence)
      }
    };
  }

  async function readDecodedConfigFiles() {
    const fflateApi = typeof fflate !== "undefined" ? fflate : window.fflate;
    const ctrApi = typeof CtrUtil !== "undefined" ? CtrUtil : window.CtrUtil;
    if (!fflateApi) throw new Error("fflate is not available in page runtime");
    if (!ctrApi?.Ctr?.Ofb_Dec) throw new Error("CtrUtil.Ctr.Ofb_Dec is not available in page runtime");
    const configItem = window.RES?.GetGroupByName?.("config")?.[0];
    const url = configItem?.url
      ? new URL(configItem.url, location.href).href
      : "https://web.sanguosha.com/220/h5_2/res/config/Config_w.sgs";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch config failed: ${response.status}`);
    const zip = fflateApi.unzipSync(new Uint8Array(await response.arrayBuffer()));
    const result = {};
    for (const name of ["sys_playcard", "cha_spell", "cha_spellextend", "character", "sys_gs_game_logic_rule_config"]) {
      const raw = zip[name + ".sgs"];
      if (!raw) throw new Error("Missing config file: " + name + ".sgs");
      const decrypted = ctrApi.Ctr.Ofb_Dec(raw.buffer);
      const decompressed = fflateApi.gunzipSync(new Uint8Array(decrypted));
      result[name] = JSON.parse(new TextDecoder().decode(decompressed));
    }
    result.__sourceUrl = url;
    return result;
  }

  async function loadGameConfig() {
    if (state.loaded) return state;
    if (loadPromise) return loadPromise;
    state.loading = true;
    state.error = "";
    state.attempts++;
    state.lastAttemptAt = Date.now();
    loadPromise = (async () => {
      try {
        const decoded = await readDecodedConfigFiles();
        const spellRows = tableRows(decoded.cha_spell, "GameSpells", "spell");
        const cardRows = tableRows(decoded.sys_playcard, "GamePlayCards", "card");
        const characterRows = tableRows(decoded.character, "GameCharacters", "character");
        const spellExtendRows = [
          ...tableRows(decoded.cha_spellextend, "GameSpells", "spellextend"),
          ...tableRows(decoded.cha_spellextend, "ExtendParam", "spell")
        ];
        const { spellDict, markSpell } = buildSpellDict(spellRows);
        const { cardDict, cardIDsOrder } = buildCardDict(cardRows, spellDict);
        const { standardDeckIds, gameRuleDecks } = buildGameRuleDecks(
          decoded.sys_gs_game_logic_rule_config,
          cardIDsOrder
        );
        const { skills: skillRules, summary: skillRuleSummary } = buildSkillRuleIndex(
          spellRows,
          characterRows,
          cardRows,
          spellExtendRows
        );
        Object.assign(state, {
          loaded: true,
          loading: false,
          error: "",
          sourceUrl: decoded.__sourceUrl,
          version: state.version + 1,
          cardCount: Object.keys(cardDict).length,
          spellCount: Object.keys(spellDict).length,
          markSpellCount: Object.keys(markSpell).length,
          cardIDsOrder,
          standardDeckIds,
          gameRuleDecks,
          cardDict,
          spellDict,
          markSpell,
          skillRules,
          skillRuleSummary
        });
        return state;
      } catch (error) {
        state.loading = false;
        state.error = String(error?.stack || error);
        throw error;
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function cardInfo(id) {
    return state.cardDict?.[Number(id)] || null;
  }

  function skillRuleInfo(id) {
    const rule = state.skillRules?.[Number(id)];
    if (!rule) return null;
    return {
      id: rule.id,
      name: rule.name,
      sourceType: rule.sourceType,
      ownerNames: Array.from(new Set((rule.owners || []).map((owner) => owner.name))).slice(0, 12),
      isPlayCardSpell: !!rule.isPlayCardSpell,
      categories: (rule.categories || []).map((item) => item.id),
      actions: rule.actions || [],
      priority: rule.priority,
      confidence: rule.confidence,
      candidateRules: rule.candidateRules || []
    };
  }

  function ensureConfigLoading(retryIntervalMs = 5000) {
    if (state.loaded || state.loading) return;
    if (Date.now() - Number(state.lastAttemptAt || 0) < retryIntervalMs) return;
    loadGameConfig().catch(() => {});
  }

  Object.assign(root.sources, {
    configState: state,
    loadGameConfig,
    ensureConfigLoading,
    cardInfo,
    skillRuleInfo
  });
})();

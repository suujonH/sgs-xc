(() => {
  const root = window.__SgsScripts;
  const plannerModule = root.modules.rulePlannerCore;
  const planner = plannerModule.makeRulePlanner({
    skillRuleInfo: (skillId) => root.sources.skillRuleInfo?.(skillId),
    maxPlans: 160
  });

  Object.assign(root.tracker, {
    rulePlanner: planner
  });
})();

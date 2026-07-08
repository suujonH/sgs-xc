export default {
  id: "xxx",
  manifest: {
    name: "xxx",
    version: "0.1.0",
    capabilities: []
  },
  install(context) {
    context.logger.info("plugin installed", "xxx");
    return () => {
      context.logger.info("plugin disposed", "xxx");
    };
  }
};

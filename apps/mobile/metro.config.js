// Workspace packages (e.g. @cetem-qc/domain) are TypeScript sources using NodeNext-style "./x.js" relative
// imports that point at "./x.ts". Metro does not map those by default, so retry such imports without ".js".
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -".js".length), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  /react-native-vision-camera_tmp_[^/]+\//,
];

config.watchFolders = (config.watchFolders ?? []).filter(Boolean);

module.exports = config;

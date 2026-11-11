import { NativeBootstrapHost } from './bootstrap.js';

/** Chrome starts this host through connectNative and passes the calling extension's origin as the first argument. */
const extensionOrigin = process.argv[2] ?? '';
if (!/^chrome-extension:\/\/[a-p]{32}\/?$/.test(extensionOrigin)) {
  process.stderr.write('[aether-native-host] Missing or invalid Chrome extension origin argument\n');
  process.exitCode = 1;
} else {
  const host = new NativeBootstrapHost();
  void host.start();
  process.once('SIGINT', () => host.close());
  process.once('SIGTERM', () => host.close());
}

export { NativeBootstrapHost } from './bootstrap.js';
export { NativeMessageDecoder, encodeNativeMessage } from './framing.js';

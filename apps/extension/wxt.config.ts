import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Aether Browser Agent',
    description: 'Connect an MCP agent to the active Chrome tab.',
    version: '0.1.0',
    permissions: ['debugger', 'nativeMessaging', 'sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Aether' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});

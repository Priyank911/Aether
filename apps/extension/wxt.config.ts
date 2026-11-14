import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Aether Browser Agent',
    description: 'Lets your MCP agent work in your Chrome, in its own tab group, with you in control.',
    version: '0.2.0',
    permissions: ['debugger', 'nativeMessaging', 'sidePanel', 'tabs', 'tabGroups', 'storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Aether' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});

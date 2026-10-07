const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    permissions: ['camera', 'microphone'],
    serviceWorkers: 'block',
    launchOptions: {
      // A synthetic camera and microphone, so recording can be tested for real.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    }
  },
  webServer: {
    command: 'node tests/serve.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI
  }
});

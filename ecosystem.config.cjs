// PM2 config that registers BOTH the connector and its watchdog, then run
// `pm2 save` so they survive reboot/resurrect. For full closure also register
// them with the runtime guardian (activity-monitor) so the watchdog itself is
// supervised — a watchdog that can silently die is the one remaining gap.
//
//   pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'hxa-connector',
      script: 'connector.mjs',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      max_restarts: 50,
      env: { ZYLOS_DIR: process.env.ZYLOS_DIR || '/home/ubuntu/zylos' },
    },
    {
      name: 'hxa-connector-watchdog',
      script: 'watchdog.mjs',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      env: {
        ZYLOS_DIR: process.env.ZYLOS_DIR || '/home/ubuntu/zylos',
        HXA_WATCHDOG_APP: 'hxa-connector',
      },
    },
  ],
};

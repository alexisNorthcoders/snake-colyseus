const os = require('os');

/**
 * COLYSEUS CLOUD WARNING:
 * ----------------------
 * PLEASE DO NOT UPDATE THIS FILE MANUALLY AS IT MAY CAUSE DEPLOYMENT ISSUES
 */

module.exports = {
  apps : [{
    name: "colyseus-app",
    script: 'build/index.js',
    time: true,
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    wait_ready: true,
    env_production: {
      NODE_ENV: 'production',
      // go-server, on the same VPS, and the secret the two share for vs-bot results
      API_URL: process.env.API_URL || 'http://localhost:8080',
      BOT_RESULTS_SECRET: process.env.BOT_RESULTS_SECRET
    }
  }],
};


const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:9001",
    supportFile: false,
    specPattern: 'tests/frontend/cypress/integration/**/*.js'
  }
})

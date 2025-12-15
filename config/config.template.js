/**
 * Example MagicMirror configuration for MMM-Webuntis (devcontainer).
 * Copy this file to `config.js` inside the same folder and adjust
 * credentials/settings as needed. The DevContainer mounts it into
 * /opt/magic_mirror/config/config.js so editing inside the container
 * writes back to this repo file.
 */
let config = {
  address: "0.0.0.0",
  port: 8080,
  basePath: "/",
  ipWhitelist: [],
  useHttps: false,
  language: "en",
  timeFormat: 24,
  units: "metric",
  modules: [
    { module: "alert" },
    { module: "clock", position: "top_left" },
    {
      module: "MMM-Webuntis",
      position: "top_right",
      config: {
        logLevel: "info",
        daysToShow: 7,
        students: [
          { title: "Sample", qrcode: "untis://setschool?" }
        ]
      }
    }
  ]
};

if (typeof module !== "undefined") {
  module.exports = config;
}

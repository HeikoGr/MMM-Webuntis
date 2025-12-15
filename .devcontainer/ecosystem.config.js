module.exports = {
  apps: [
    {
      name: 'magicmirror',
      script: '/opt/magic_mirror/serveronly/index.js',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8080
      }
    }
  ]
};
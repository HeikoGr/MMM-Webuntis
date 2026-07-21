# Update

## Standard Update

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
node -v
git pull
npm ci --omit=dev
```

## When `git pull` Fails

If your local checkout diverged and you do not need local changes, reset after backing up anything important:

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
git fetch origin
git reset --hard origin/master
npm ci --omit=dev
```

If you do have local changes you want to keep, resolve them before resetting.

## After Updating

Check these points:

- your Node version is still at least `20.18.1`
- your MagicMirror config still matches the current options
- QR or account credentials still work

If the module starts but shows no data, continue with [Troubleshooting](Troubleshooting).
const { execSync } = require('child_process');

try {
  // Prüfen, ob simple-git-hooks überhaupt installiert ist
  require.resolve('simple-git-hooks');

  // Falls vorhanden: CLI ausführen (vermeidet Abhängigkeit von interner API)
  try {
    execSync('npx simple-git-hooks install', { stdio: 'inherit' });
    console.log('Git hooks installed successfully');
  } catch (e) {
    // Wenn das CLI-Aufruf schiefgeht, loggen, aber Fehler nicht weiterreichen
    console.error('simple-git-hooks found but CLI install failed:', e.message);
    console.log('Continuing without failing the install.');
  }
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    // In Production / bei --omit=dev ist das erwartetes Verhalten
    console.log('Skipping git hooks installation: simple-git-hooks is not installed.');
  } else {
    console.error('Unexpected error while checking simple-git-hooks:', err.message || err);
    console.log('Continuing without failing the install.');
  }
}

module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/', '/debug_dumps/', '/scripts/archive/'],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  // Disable coverage for specific files to avoid jest 30 + babel-plugin-istanbul issues
  collectCoverageFrom: ['lib/**/*.js', '!lib/**/*.test.js'],
  coverageProvider: 'v8', // Use v8 instead of babel for coverage
};

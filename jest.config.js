module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/', '/debug_dumps/', '/scripts/archive/'],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
};

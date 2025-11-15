module.exports = {
  preset: 'react-native',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-builder-bob)/)'
  ],
  setupFiles: ['./jest.setup.js'],
};

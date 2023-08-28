module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.[jt]sx?$': '<rootDir>/jest-preprocess.js',
    },
    moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '.+\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/__mocks__/file-mock.js',
        // If you are using tsconfig paths, uncomment the following line
        // ...paths,
    },
    testPathIgnorePatterns: ['/node_modules/', '/.cache/', '/public/'],
    transformIgnorePatterns: ['node_modules/(?!(gatsby|gatsby-script|gatsby-link)/)'],
    globals: {
        __PATH_PREFIX__: '',
    },
    setupFiles: ['<rootDir>/loadershim.js'],
    setupFilesAfterEnv: ['@testing-library/jest-dom', './jest.setup.js'],
    collectCoverage: true,
    coverageReporters: ['json', 'lcov', 'text', 'clover'],
};

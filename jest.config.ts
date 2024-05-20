import type { Config } from 'jest';

const config: Config = {
    transform: {
        '^.+\\.(t|j)sx?$': '@swc/jest',
    },
    setupFiles: ['<rootDir>/jest.setup.ts'],
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;

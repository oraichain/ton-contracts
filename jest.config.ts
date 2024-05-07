import type { Config } from 'jest';

const config: Config = {
    transform: {
        '^.+\\.(t|j)sx?$': '@swc/jest',
    },
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;

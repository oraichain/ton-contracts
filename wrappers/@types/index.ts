import { SendMode } from '@ton/core';
import { Maybe } from 'ton/dist/types';

export type ValueOps = {
    value: bigint | string;
    queryId?: number;
    bounce?: Maybe<boolean>;
    sendMode?: SendMode;
};

import { SendMode } from '@ton/core';
import { Maybe } from 'ton/dist/types';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
export * from './serialize';

export type TxBodyWasm = {
    messages: {
        typeUrl: string;
        value: MsgExecuteContract;
    }[];
    memo: string;
    timeoutHeight: bigint;
    extensionOptions: Any[];
    nonCriticalExtensionOptions: Any[];
};

export type TxWasm = {
    body: TxBodyWasm;
    authInfo: AuthInfo;
    signatures: Readonly<Uint8Array[]>;
};

export type BasicTxInfo = {
    hash: string;
    height: number;
    time?: string;
};

export type ValueOps = {
    value: bigint | string;
    queryId?: number;
    bounce?: Maybe<boolean>;
    sendMode?: SendMode;
};

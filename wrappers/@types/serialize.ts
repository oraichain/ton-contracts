import { BlockIdFlag, Version } from '@cosmjs/tendermint-rpc';

export type SerializedBlockId = {
    hash: string;
    parts: {
        total: number;
        hash: string;
    };
};

export type SerializedValidator = {
    address: string;
    pub_key: {
        type: 'ed25519' | 'secp256k1';
        value: string;
    };
    voting_power: bigint;
    proposer_priority: number;
};

export type SerializedHeader = {
    time: string;
    blockId: SerializedBlockId;
    lastCommitHash: string;
    dataHash: string;
    validatorsHash: string;
    nextValidatorsHash: string;
    consensusHash: string;
    lastBlockId: SerializedBlockId;
    version: Version;
    chainId: string;
    height: number;
    appHash: string;
    lastResultsHash: string;
    evidenceHash: string;
    proposerAddress: string;
};

export type SerializedSignature = {
    blockIdFlag: BlockIdFlag;
    validatorAddress: string;
    timestamp: string | null;
    signature: string;
};

export type SerializedCommit = {
    blockId: SerializedBlockId;
    signatures: SerializedSignature[];
    height: number;
    round: number;
};

export type SerializedTx = string;

export type LightClientData = {
    validators: SerializedValidator[];
    lastCommit: SerializedCommit;
    header: SerializedHeader;
    txs: SerializedTx[];
};

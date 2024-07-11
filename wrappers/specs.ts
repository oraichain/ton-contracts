import { HashOp, LengthOp } from 'cosmjs-types/cosmos/ics23/v1/proofs';

export const iavlSpec = {
    leafSpec: {
        prefix: Uint8Array.from([0]),
        hash: HashOp.SHA256,
        prehashValue: HashOp.SHA256,
        prehashKey: HashOp.NO_HASH,
        length: LengthOp.VAR_PROTO,
    },
    innerSpec: {
        childOrder: [0, 1],
        minPrefixLength: 4,
        maxPrefixLength: 12,
        childSize: 33,
        hash: HashOp.SHA256,
    },
};

export const tendermintSpec = {
    leafSpec: {
        prefix: Uint8Array.from([0]),
        hash: HashOp.SHA256,
        prehashValue: HashOp.SHA256,
        prehashKey: HashOp.NO_HASH,
        length: LengthOp.VAR_PROTO,
    },
    innerSpec: {
        childOrder: [0, 1],
        minPrefixLength: 1,
        maxPrefixLength: 1,
        childSize: 32,
        hash: HashOp.SHA256,
    },
};

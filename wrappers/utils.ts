import { Cell, Tuple, TupleItem, TupleItemSlice, beginCell } from '@ton/core';
import crypto from 'crypto';
import { Any } from 'cosmjs-types/google/protobuf/any';

import {
    Fee,
    Tip,
    TxBody,
    ModeInfo_Single,
    SignerInfo,
    AuthInfo,
} from 'cosmjs-types/cosmos/tx/v1beta1/tx';

import { int64FromString, writeVarint64 } from 'cosmjs-types/varint';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import {
    LightClientData,
    SerializedBlockId,
    SerializedCommit,
    SerializedHeader,
    SerializedTx,
    SerializedValidator,
    TxBodyWasm,
} from './@types';
import {
    Commit,
    Header,
    Validator,
    BlockId,
    ReadonlyDateWithNanoseconds,
    toSeconds,
    toRfc3339WithNanoseconds,
    fromRfc3339WithNanoseconds,
    Tendermint34Client,
} from '@cosmjs/tendermint-rpc';
import {
    CommitmentProof,
    ExistenceProof,
    InnerOp,
    LeafOp,
    ProofSpec,
} from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { calculateExistenceRoot, ics23, verifyMembership } from '@confio/ics23';
import { QueryClient } from '@cosmjs/stargate';
import { fromBech32, toAscii } from '@cosmjs/encoding';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { iavlSpec, tendermintSpec } from './specs';

export type TestClientConfig = {
    id: number;
    counter: number;
};

export function testClientConfigToCell(config: TestClientConfig): Cell {
    return beginCell().storeUint(config.id, 32).storeUint(config.counter, 32).endCell();
}
export type Version = {
    block: string | number;
    app?: string | number;
};

export type CanonicalVote = {
    type: number;
    height: number;
    round: number;
    block_id: BlockId;
    timestamp: string;
    chain_id: string;
};

export const getTimeComponent = (timestampz: string) => {
    const millis = new Date(timestampz).getTime();
    const seconds = Math.floor(millis / 1000);
    // ghetto, we're pulling the nanoseconds from the string
    const withoutZone = timestampz.slice(0, -1);
    const nanosStr = withoutZone.split('.')[1] || '';
    const nanoseconds = Number(nanosStr.padEnd(9, '0'));
    return { seconds, nanoseconds };
};

export const getVersionSlice = (version: Version): Cell => {
    let cell = beginCell();
    cell = cell.storeUint(Number(version.block), 32);
    if (version.app) {
        cell = cell.storeUint(Number(version.app), 32);
    }

    return cell.endCell();
};

export const getTimeSlice = (timestampz: ReadonlyDateWithNanoseconds): Cell => {
    const { seconds, nanos } = toSeconds(timestampz);
    let cell = beginCell();
    cell = cell.storeUint(seconds < 0 ? 0 : seconds, 32).storeUint(nanos < 0 ? 0 : nanos, 32);

    return cell.endCell();
};

export const getInt64Slice = (modeInfo: ModeInfo_Single) => {
    const { lo, hi } = int64FromString(modeInfo.mode.toString());
    const buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    return beginCell().storeBuffer(Buffer.from(buff)).endCell();
};

export const getBlockSlice = (blockId: BlockId): Cell => {
    return beginCell()
        .storeUint(
            blockId.hash ? BigInt('0x' + Buffer.from(blockId.hash).toString('hex')) : 0n,
            256,
        )
        .storeUint(
            blockId.parts.hash
                ? BigInt('0x' + Buffer.from(blockId.parts.hash).toString('hex'))
                : 0n,
            256,
        )
        .storeUint(blockId.parts.total, 8)
        .endCell();
};

export const getSignInfoCell = (mode: SignerInfo): Cell => {
    const typeUrl = beginCell().storeBuffer(Buffer.from(mode!.publicKey!.typeUrl)).endCell();
    const value = buildRecursiveSliceRef(mode!.publicKey!.value);
    const anyCell = beginCell()
        .storeRef(typeUrl)
        .storeRef(value || beginCell().endCell())
        .endCell();
    const modeInfo = mode.modeInfo?.single
        ? getInt64Slice(mode.modeInfo?.single)
        : beginCell().endCell();
    const { lo, hi } = int64FromString(mode.sequence.toString());
    const buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    const sequence = beginCell().storeBuffer(Buffer.from(buff)).endCell();
    const inputCell = beginCell().storeRef(anyCell).storeRef(modeInfo).storeRef(sequence).endCell();
    return inputCell;
};

export const getFeeCell = (fee: Fee): Cell => {
    const { lo, hi } = int64FromString(fee.gasLimit.toString());
    const buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    let amountsCell;
    for (let i = fee.amount.length - 1; i >= 0; i--) {
        const innerCell = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(fee.amount[i].denom)).endCell())
            .storeRef(beginCell().storeBuffer(Buffer.from(fee.amount[i].amount)).endCell())
            .endCell();
        if (!amountsCell) {
            amountsCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            amountsCell = beginCell().storeRef(amountsCell).storeRef(innerCell).endCell();
        }
    }
    const inputRef = beginCell()
        .storeRef(amountsCell!)
        .storeRef(beginCell().storeBuffer(Buffer.from(buff)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(fee.payer)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(fee.granter)).endCell())
        .endCell();
    return inputRef;
};

export const getTipCell = (tip: Tip): Cell => {
    let amountsCell;
    for (let i = tip.amount.length - 1; i >= 0; i--) {
        const innerCell = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(tip.amount[i].denom)).endCell())
            .storeRef(beginCell().storeBuffer(Buffer.from(tip.amount[i].amount)).endCell())
            .endCell();
        if (!amountsCell) {
            amountsCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            amountsCell = beginCell().storeRef(amountsCell).storeRef(innerCell).endCell();
        }
    }

    const inputCell = beginCell()
        .storeRef(amountsCell!)
        .storeRef(beginCell().storeBuffer(Buffer.from(tip.tipper)).endCell())
        .endCell();
    return inputCell;
};

export const buildCellTuple = (value: string | Uint8Array) => {
    const tupleCell: TupleItem[] = [];
    let longBuf = Buffer.from(value);
    if (typeof value === 'string') {
        longBuf = Buffer.from(value, 'base64');
    }

    for (let i = 0; i < longBuf.length; i += 127) {
        tupleCell.push({
            type: 'slice',
            cell: beginCell()
                .storeBuffer(Buffer.from(longBuf.subarray(i, Math.min(longBuf.length, i + 127))))
                .endCell(),
        });
    }
    return tupleCell;
};

export const buildRecursiveSliceRef = (value: string | Uint8Array): Cell | undefined => {
    let longBuf = Buffer.from(value);
    let innerCell: Cell | undefined;

    if (typeof value === 'string') {
        longBuf = Buffer.from(value, 'base64');
    }

    for (let i = longBuf.length; i > 0; i -= 127) {
        if (!innerCell) {
            innerCell = beginCell()
                .storeRef(beginCell().endCell()) // This still stop when reach that ref, but this will be our convention for more than two refs recursive
                .storeBuffer(Buffer.from(longBuf.subarray(Math.max(0, i - 127), i)))
                .endCell();
        } else {
            innerCell = beginCell()
                .storeRef(innerCell)
                .storeBuffer(Buffer.from(longBuf.subarray(Math.max(0, i - 127), i)))
                .endCell();
        }
    }

    return innerCell;
};

export const buildSliceTupleFromUint8Array = (value: Uint8Array) => {
    const tupleCell: TupleItem[] = [];

    for (let i = 0; i < value.length; i += 127) {
        tupleCell.push({
            type: 'slice',
            cell: beginCell()
                .storeBuffer(Buffer.from(value.subarray(i, Math.min(value.length, i + 127))))
                .endCell(),
        });
    }
    return tupleCell;
};

export const anyToTuple = (value: Any): Tuple => {
    const tupleAny: TupleItem[] = [];

    const typeUrlSlice: TupleItemSlice = {
        type: 'slice',
        cell: beginCell().storeBuffer(Buffer.from(value.typeUrl)).endCell(),
    };

    tupleAny.push(typeUrlSlice);
    tupleAny.push({ type: 'tuple', items: buildCellTuple(value.value) });

    return {
        type: 'tuple',
        items: tupleAny,
    };
};

const leafPrefix = Uint8Array.from([0]);
const innerPrefix = Uint8Array.from([1]);

// getSplitPoint returns the largest power of 2 less than length
const getSplitPoint = (length: number) => {
    if (length < 1) {
        throw new Error('Trying to split a tree with size < 1');
    }

    const bitlen = (Math.log2(length) + 1) >> 0;
    let k = 1 << (bitlen - 1);
    if (k === length) {
        k >>= 1;
    }
    return k;
};

// returns tmhash(0x01 || left || right)
export const innerHash = (left: Buffer, right: Buffer) => {
    return crypto
        .createHash('sha256')
        .update(Buffer.concat([innerPrefix, left, right]))
        .digest();
};

export const leafHash = (leaf: Buffer) => {
    const leafBuf = Buffer.concat([leafPrefix, leaf]);
    return crypto.createHash('sha256').update(leafBuf).digest();
};

export interface MerkleTree {
    left?: MerkleTree;
    right?: MerkleTree;
    parent?: MerkleTree;
    value?: Buffer;
}

export const getMerkleTree = (items: Buffer[], lookUp: { [key: string]: MerkleTree } = {}) => {
    const root: MerkleTree = {};
    switch (items.length) {
        case 0:
            root.value = crypto.createHash('sha256').update(Buffer.from([])).digest();
            break;
        case 1:
            root.value = leafHash(items[0]);
            break;
        default:
            const k = getSplitPoint(items.length);
            root.left = getMerkleTree(items.slice(0, k), lookUp).root;
            root.right = getMerkleTree(items.slice(k), lookUp).root;
            root.value = innerHash(root.left.value!, root.right.value!);
            root.left.parent = root.right.parent = root;
    }
    lookUp[root.value!.toString('hex')] = root;
    return { root, lookUp };
};

export const getMerkleProofs = (leaves: Buffer[], leafData: Buffer) => {
    const { root, lookUp } = getMerkleTree(leaves);
    const leaf = leafHash(leafData);
    let node = lookUp[Buffer.from(leaf).toString('hex')];
    let positions = beginCell();
    const branch = [];
    let branchCell: Cell | undefined;
    while (node.parent) {
        const isRight = node.parent.right!.value!.equals(node.value!);
        // left is 1, right is 0
        positions = positions.storeBit(isRight ? 1 : 0);
        branch.push(isRight ? node.parent.left!.value! : node.parent.right!.value!);
        node = node.parent;
    }

    for (let i = branch.length - 1; i >= 0; i--) {
        const innerCell = beginCell().storeBuffer(branch[i]).endCell();
        if (!branchCell) {
            branchCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            branchCell = beginCell().storeRef(branchCell).storeRef(innerCell).endCell();
        }
    }

    return { root, branch: branchCell, positions: positions.endCell() };
};

export const txBodyWasmToRef = (txBodyWasm: TxBodyWasm) => {
    let messagesCell: Cell | undefined;

    for (let i = txBodyWasm.messages.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.messages[i].typeUrl))
            .endCell();
        const value = msgExecuteContractToCell(txBodyWasm.messages[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!messagesCell) {
            messagesCell = beginCell()
                .storeRef(beginCell().endCell())
                .storeRef(innerCell)
                .endCell();
        } else {
            messagesCell = beginCell().storeRef(messagesCell).storeRef(innerCell).endCell();
        }
    }

    const memo_timeout_height_builder = beginCell();

    if (txBodyWasm.memo) {
        memo_timeout_height_builder.storeRef(
            beginCell().storeBuffer(Buffer.from(txBodyWasm.memo, 'hex')).endCell(),
        );
    }

    if (txBodyWasm.timeoutHeight > 0n) {
        memo_timeout_height_builder.storeUint(txBodyWasm.timeoutHeight, 64);
    }

    let extCell;
    for (let i = txBodyWasm.extensionOptions.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.extensionOptions[i].typeUrl))
            .endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.extensionOptions[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!extCell) {
            extCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            extCell = beginCell().storeRef(extCell).storeRef(innerCell).endCell();
        }
    }

    let nonExtCell;
    for (let i = txBodyWasm.nonCriticalExtensionOptions.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.nonCriticalExtensionOptions[i].typeUrl))
            .endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.nonCriticalExtensionOptions[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!nonExtCell) {
            nonExtCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            nonExtCell = beginCell().storeRef(nonExtCell).storeRef(innerCell).endCell();
        }
    }

    return beginCell()
        .storeRef(messagesCell ? messagesCell : beginCell().endCell())
        .storeRef(memo_timeout_height_builder.endCell())
        .storeRef(extCell ? extCell : beginCell().endCell())
        .storeRef(nonExtCell ? nonExtCell : beginCell().endCell())
        .endCell();
};

export const txBodyToSliceRef = (txBodyWasm: TxBody) => {
    let messagesCell;
    for (let i = txBodyWasm.messages.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.messages[i].typeUrl))
            .endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.messages[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!messagesCell) {
            messagesCell = beginCell()
                .storeRef(beginCell().endCell())
                .storeRef(innerCell)
                .endCell();
        } else {
            messagesCell = beginCell().storeRef(messagesCell).storeRef(innerCell).endCell();
        }
    }

    const memo_timeout_height_builder = beginCell();
    if (txBodyWasm.memo) {
        const memoBuilder = beginCell().storeBuffer(Buffer.from(txBodyWasm.memo, 'hex'));
        memo_timeout_height_builder.storeRef(memoBuilder.endCell());
    }

    if (txBodyWasm.timeoutHeight > 0n) {
        memo_timeout_height_builder.storeUint(txBodyWasm.timeoutHeight, 64);
    }

    let extCell;
    for (let i = txBodyWasm.extensionOptions.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.extensionOptions[i].typeUrl))
            .endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.extensionOptions[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!extCell) {
            extCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            extCell = beginCell().storeRef(extCell).storeRef(innerCell).endCell();
        }
    }

    let nonExtCell;
    for (let i = txBodyWasm.nonCriticalExtensionOptions.length - 1; i >= 0; i--) {
        const typeUrl = beginCell()
            .storeBuffer(Buffer.from(txBodyWasm.nonCriticalExtensionOptions[i].typeUrl))
            .endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.nonCriticalExtensionOptions[i].value);
        const innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!nonExtCell) {
            nonExtCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            nonExtCell = beginCell().storeRef(nonExtCell).storeRef(innerCell).endCell();
        }
    }

    return beginCell()
        .storeRef(messagesCell ? messagesCell : beginCell().endCell())
        .storeRef(memo_timeout_height_builder.endCell())
        .storeRef(extCell ? extCell : beginCell().endCell())
        .storeRef(nonExtCell ? nonExtCell : beginCell().endCell())
        .endCell();
};

export const msgExecuteContractToCell = (msg: MsgExecuteContract) => {
    const sender_contract = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(msg.sender)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(msg.contract)).endCell())
        .endCell();

    const msgToTuple = buildRecursiveSliceRef(msg.msg);

    let fundCell;
    for (let i = msg.funds.length - 1; i >= 0; i--) {
        const item = msg.funds[i];
        const innerCell = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
            .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
            .endCell();
        if (!fundCell) {
            fundCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            fundCell = beginCell().storeRef(fundCell).storeRef(innerCell).endCell();
        }
    }

    return beginCell()
        .storeRef(sender_contract)
        .storeRef(msgToTuple ?? beginCell().endCell())
        .storeRef(fundCell ?? beginCell().endCell())
        .endCell();
};

export type PubKey = {
    type?: string;
    value?: string;
};

export type Validators = {
    address: string;
    pub_key: PubKey;
    voting_power: string;
    proposer_priority: string;
};

export type Signature = {
    block_id_flag: number;
    validator_address: string;
    timestamp: string;
    signature: string | null;
};

export const serializeValidator = (validator: Validator): SerializedValidator => {
    return {
        address: Buffer.from(validator.address).toString('hex'),
        pub_key: {
            type: validator.pubkey!.algorithm,
            value: Buffer.from(validator.pubkey!.data).toString('hex'),
        },
        voting_power: validator.votingPower,
        proposer_priority: validator.proposerPriority!,
    };
};

export const serializeBlockId = (blockId: BlockId | null): SerializedBlockId | null => {
    return blockId
        ? {
              hash: Buffer.from(blockId.hash).toString('hex'),
              parts: {
                  total: blockId.parts.total,
                  hash: Buffer.from(blockId.parts.hash).toString('hex'),
              },
          }
        : null;
};

export const serializeHeader = (header: Header): SerializedHeader => {
    return {
        ...header,
        lastBlockId: serializeBlockId(header.lastBlockId)!,
        time: toRfc3339WithNanoseconds(header.time),
        blockId: serializeBlockId(header.lastBlockId)!,
        lastCommitHash: Buffer.from(header.lastCommitHash).toString('hex'),
        dataHash: Buffer.from(header.dataHash).toString('hex'),
        validatorsHash: Buffer.from(header.validatorsHash).toString('hex'),
        nextValidatorsHash: Buffer.from(header.nextValidatorsHash).toString('hex'),
        consensusHash: Buffer.from(header.consensusHash).toString('hex'),
        appHash: Buffer.from(header.appHash).toString('hex'),
        lastResultsHash: Buffer.from(header.lastResultsHash).toString('hex'),
        evidenceHash: Buffer.from(header.evidenceHash).toString('hex'),
        proposerAddress: Buffer.from(header.proposerAddress).toString('hex'),
    };
};

export const serializeCommit = (commit: Commit): SerializedCommit => {
    return {
        ...commit,
        blockId: serializeBlockId(commit.blockId)!,
        signatures: commit.signatures.map((sig) => {
            let timestamp;
            try {
                timestamp = sig.timestamp ? toRfc3339WithNanoseconds(sig.timestamp) : null;
            } catch (error) {
                timestamp = null;
            }
            return {
                blockIdFlag: sig.blockIdFlag,
                validatorAddress: sig.validatorAddress
                    ? Buffer.from(sig.validatorAddress).toString('hex')
                    : '',
                timestamp,
                signature: sig.signature ? Buffer.from(sig.signature).toString('hex') : '',
            };
        }),
    };
};

export const deserializeValidator = (serializedValidator: SerializedValidator): Validator => {
    return {
        address: Buffer.from(serializedValidator.address, 'hex'),
        pubkey: {
            algorithm: serializedValidator.pub_key.type,
            data: Buffer.from(serializedValidator.pub_key.value, 'hex'),
        },
        votingPower: serializedValidator.voting_power,
        proposerPriority: serializedValidator.proposer_priority,
    };
};

export const deserializeBlockId = (serializedBlockId: SerializedBlockId | null): BlockId | null => {
    if (serializedBlockId) {
        return {
            hash: Buffer.from(serializedBlockId.hash, 'hex'),
            parts: {
                total: serializedBlockId.parts.total,
                hash: Buffer.from(serializedBlockId.parts.hash, 'hex'),
            },
        };
    } else {
        return null;
    }
};

export const deserializeHeader = (serializedHeader: SerializedHeader): Header => {
    return {
        ...serializedHeader,
        time: fromRfc3339WithNanoseconds(serializedHeader.time),
        lastBlockId: deserializeBlockId(serializedHeader.blockId),
        lastCommitHash: Buffer.from(serializedHeader.lastCommitHash, 'hex'),
        dataHash: Buffer.from(serializedHeader.dataHash, 'hex'),
        validatorsHash: Buffer.from(serializedHeader.validatorsHash, 'hex'),
        nextValidatorsHash: Buffer.from(serializedHeader.nextValidatorsHash, 'hex'),
        consensusHash: Buffer.from(serializedHeader.consensusHash, 'hex'),
        appHash: Buffer.from(serializedHeader.appHash, 'hex'),
        lastResultsHash: Buffer.from(serializedHeader.lastResultsHash, 'hex'),
        evidenceHash: Buffer.from(serializedHeader.evidenceHash, 'hex'),
        proposerAddress: Buffer.from(serializedHeader.proposerAddress, 'hex'),
    };
};
export const deserializeCommit = (serializedCommit: SerializedCommit): Commit => {
    return {
        ...serializedCommit,
        blockId: deserializeBlockId(serializedCommit.blockId)!,
        signatures: serializedCommit.signatures.map((sig) => {
            return {
                blockIdFlag: sig.blockIdFlag,
                validatorAddress: sig.validatorAddress
                    ? Buffer.from(sig.validatorAddress, 'hex')
                    : Buffer.from(''),
                timestamp: sig.timestamp
                    ? fromRfc3339WithNanoseconds(sig.timestamp)
                    : new Date('0001-01-01T00:00:00Z'),
                signature: sig.signature ? Buffer.from(sig.signature, 'hex') : undefined,
            };
        }),
    };
};

export function getAuthInfoInput(data: AuthInfo) {
    let finalSignInfosCell;
    for (let i = data.signerInfos.length - 1; i >= 0; i--) {
        const innerCell = getSignInfoCell(data.signerInfos[i]);
        if (!finalSignInfosCell) {
            finalSignInfosCell = beginCell()
                .storeRef(beginCell().endCell())
                .storeRef(innerCell)
                .endCell();
        } else {
            finalSignInfosCell = beginCell()
                .storeRef(finalSignInfosCell!)
                .storeRef(innerCell)
                .endCell();
        }
    }
    let fee = beginCell().endCell();
    if (data.fee) {
        fee = getFeeCell(data.fee);
    }
    let tip = beginCell().endCell();
    if (data.tip) {
        tip = getTipCell(data.tip);
    }
    return { signInfos: finalSignInfosCell, fee, tip };
}

export const getCommitCell = (commit: Commit) => {
    let signatureCell: Cell | undefined;
    for (let i = commit.signatures.length - 1; i >= 0; i--) {
        const signature = commit.signatures[i];
        const cell = beginCell()
            .storeUint(signature.blockIdFlag, 8)
            .storeBuffer(Buffer.from(signature.validatorAddress!))
            .storeRef(getTimeSlice(signature.timestamp!))
            .storeBuffer(signature.signature ? Buffer.from(signature.signature) : Buffer.from(''))
            .endCell();
        if (!signatureCell) {
            signatureCell = beginCell().storeRef(beginCell().endCell()).storeRef(cell).endCell();
        } else {
            signatureCell = beginCell().storeRef(signatureCell).storeRef(cell).endCell();
        }
    }
    const commitCell = beginCell()
        .storeUint(BigInt(commit.height), 32)
        .storeUint(BigInt(commit.round), 32)
        .storeRef(getBlockSlice(commit.blockId))
        .storeRef(signatureCell!)
        .endCell();
    return commitCell;
};

export const getValidatorsCell = (validators: Validator[]) => {
    let validatorCell;
    for (let i = validators.length - 1; i >= 0; i--) {
        let builder = beginCell().storeBuffer(Buffer.from(validators[i].address));
        if (validators[i]?.pubkey?.data) {
            builder = builder.storeRef(
                beginCell().storeBuffer(Buffer.from(validators[i].pubkey!.data)).endCell(),
            );
        } else {
            builder = builder.storeRef(
                beginCell()
                    .storeBuffer(
                        Buffer.from(
                            Array.from({ length: 32 })
                                .map(() => 0)
                                .join(''),
                            'hex',
                        ),
                    )
                    .endCell(),
            );
        }
        builder = builder.storeUint(validators[i].votingPower, 32);
        const innerCell = builder.endCell();
        if (!validatorCell) {
            validatorCell = beginCell()
                .storeRef(beginCell().endCell())
                .storeRef(innerCell)
                .endCell();
        } else {
            validatorCell = beginCell().storeRef(validatorCell).storeRef(innerCell).endCell();
        }
    }
    return validatorCell;
};

export const getBlockHashCell = (header: Header) => {
    const cell = beginCell()
        .storeRef(getVersionSlice(header.version))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.chainId)).endCell())
        .storeUint(header.height, 32)
        .storeRef(getTimeSlice(header.time))
        .storeRef(getBlockSlice(header.lastBlockId!))
        .storeBuffer(Buffer.from(header.proposerAddress));

    const hashCell1 = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(header.lastCommitHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.dataHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.validatorsHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.nextValidatorsHash)));

    const hashCell2 = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(header.consensusHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.appHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.lastResultsHash)))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.evidenceHash)));

    const dsCell = beginCell().storeRef(cell).storeRef(hashCell1).storeRef(hashCell2).endCell();

    return dsCell;
};

export const getExistLeafOpCell = (leaf: LeafOp) => {
    return beginCell()
        .storeUint(leaf.prehashKey, 8)
        .storeUint(leaf.prehashValue, 8)
        .storeUint(leaf.hash, 8)
        .storeUint(leaf.length, 8)
        .storeRef(beginCell().storeBuffer(Buffer.from(leaf.prefix)).endCell());
};

export const getPathOpCell = (innerOps: InnerOp[]) => {
    let innerOpsCell;
    for (let i = innerOps.length - 1; i >= 0; i--) {
        const innerOp = innerOps[i];
        const innerCell = beginCell()
            .storeUint(innerOp.hash, 8)
            .storeRef(
                innerOp.prefix
                    ? beginCell().storeBuffer(Buffer.from(innerOp.prefix)).endCell()
                    : beginCell().endCell(),
            )
            .storeRef(
                innerOp.suffix
                    ? beginCell().storeBuffer(Buffer.from(innerOp.suffix)).endCell()
                    : beginCell().endCell(),
            );
        if (!innerOpsCell) {
            innerOpsCell = beginCell()
                .storeRef(beginCell().endCell())
                .storeBuilder(innerCell)
                .endCell();
        } else {
            innerOpsCell = beginCell().storeRef(innerOpsCell).storeBuilder(innerCell).endCell();
        }
    }
    return innerOpsCell;
};

export const getExistenceProofCell = (proof: ExistenceProof) => {
    const builder = beginCell()
        .storeBuffer(Buffer.from(proof.key))
        .storeRef(beginCell().storeBuffer(Buffer.from(proof.value)).endCell())
        .storeRef(getExistLeafOpCell(proof.leaf!))
        .storeRef(getPathOpCell(proof.path!)!);
    return builder.endCell();
};

export const getSpecCell = (spec: ProofSpec) => {
    const leafSpec = spec.leafSpec;
    const innerSpec = spec.innerSpec;
    const leafSpecCell = beginCell()
        .storeUint(leafSpec?.prehashKey!, 8)
        .storeUint(leafSpec?.prehashValue!, 8)
        .storeUint(leafSpec?.hash!, 8)
        .storeUint(leafSpec?.length!, 8)
        .storeRef(beginCell().storeBuffer(Buffer.from(leafSpec?.prefix!)).endCell());

    const innerSpecCell = beginCell()
        .storeUint(innerSpec?.hash!, 8)
        .storeUint(innerSpec?.minPrefixLength!, 8)
        .storeUint(innerSpec?.maxPrefixLength!, 8)
        .storeUint(innerSpec?.childOrder?.length!, 8)
        .storeUint(innerSpec?.childSize!, 8);

    return beginCell().storeRef(leafSpecCell.endCell()).storeRef(innerSpecCell.endCell()).endCell();
};

export const getVerifyExistenceInput = (
    root: Uint8Array,
    proof: ExistenceProof,
    spec: ProofSpec,
    key: Uint8Array,
    value: Uint8Array,
) => {
    const builder = beginCell()
        .storeUint(BigInt('0x' + Buffer.from(root).toString('hex')), 256)
        .storeBuffer(Buffer.from(key))
        .storeRef(getExistenceProofCell(proof))
        .storeRef(getSpecCell(spec))
        .storeRef(beginCell().storeBuffer(Buffer.from(value)).endCell());
    return builder.endCell();
};

export const getVerifyChainedMembershipProof = (
    root: Uint8Array,
    proofs: ExistenceProof[],
    specs: ProofSpec[],
    keys: { keyPath: Uint8Array[] },
    value: Uint8Array,
) => {
    let cellSpecs;
    let cellKeys;
    let cellProofs = getExistenceProofSnakeCell(proofs);

    for (let i = specs.length - 1; i >= 0; i--) {
        const innerCell = getSpecCell(specs[i]);
        if (!cellSpecs) {
            cellSpecs = beginCell()
                .storeRef(beginCell().endCell())
                .storeSlice(innerCell.beginParse())
                .endCell();
        } else {
            cellSpecs = beginCell()
                .storeRef(cellSpecs)
                .storeSlice(innerCell.beginParse())
                .endCell();
        }
    }
    // reverse order of keyPath
    for (let i = 0; i < keys.keyPath.length; i++) {
        if (!cellKeys) {
            cellKeys = beginCell()
                .storeRef(beginCell().endCell())
                .storeBuffer(Buffer.from(keys.keyPath[i]))
                .endCell();
        } else {
            cellKeys = beginCell()
                .storeRef(cellKeys)
                .storeBuffer(Buffer.from(keys.keyPath[i]))
                .endCell();
        }
    }

    return beginCell()
        .storeUint(BigInt('0x' + Buffer.from(root).toString('hex')), 256)
        .storeBuffer(Buffer.from(value))
        .storeRef(cellProofs!)
        .storeRef(cellSpecs!)
        .storeRef(cellKeys!)
        .endCell();
};

export function getExistenceProofSnakeCell(proofs: ExistenceProof[]) {
    let cellProofs;
    for (let i = proofs.length - 1; i >= 0; i--) {
        const innerCell = getExistenceProofCell(proofs[i]);
        if (!cellProofs) {
            cellProofs = beginCell()
                .storeRef(beginCell().endCell())
                .storeSlice(innerCell.beginParse())
                .endCell();
        } else {
            cellProofs = beginCell()
                .storeRef(cellProofs)
                .storeSlice(innerCell.beginParse())
                .endCell();
        }
    }
    return cellProofs;
}

export function verifyChainedMembershipProof(
    root: Uint8Array,
    specs: ProofSpec[],
    proofs: ics23.CommitmentProof[],
    keys: { keyPath: Uint8Array[] },
    value: Uint8Array,
    index: number,
): null | Error {
    let subroot: Uint8Array = value;
    for (let i = index; i < proofs.length; i++) {
        const keyIndex = keys.keyPath.length - 1 - i;
        const key = keys.keyPath[keyIndex];

        if (!key) {
            throw new Error(`could not retrieve key bytes for key ${keys.keyPath[keyIndex]}`);
        }
        if (proofs[i]?.exist) {
            try {
                subroot = calculateExistenceRoot(proofs[i].exist as ics23.IExistenceProof);
                console.log(Buffer.from(subroot).toString());
            } catch (err) {
                console.log(err);
            }

            const ok = verifyMembership(
                proofs[i] as ics23.CommitmentProof,
                specs[i] as ics23.IProofSpec,
                subroot,
                key,
                value,
            );

            if (!ok) {
                throw new Error(`failed to verify membership at index ${i}`);
            }
            value = subroot;
        } else if (proofs[i].nonexist) {
            throw new Error('Non-existence proof not supported');
        } else {
            throw new Error('Invalid proof type');
        }
    }
    if (Buffer.compare(subroot, root) !== 0) {
        throw new Error('Root mismatch');
    }
    console.log('Root match');
    return null;
}

export const encodeNamespaces = (namespaces: Uint8Array[]): Uint8Array => {
    const ret = [];
    for (const ns of namespaces) {
        const lengthBuf = Buffer.allocUnsafe(2);
        lengthBuf.writeUInt16BE(ns.byteLength);
        ret.push(lengthBuf);
        ret.push(ns);
    }
    return Buffer.concat(ret);
};

export async function getPacketProofs(
    queryClient: QueryClient,
    contract: string,
    proven_height: number,
    seq: bigint,
) {
    const contractBech = fromBech32(contract);
    const namespace = encodeNamespaces([Buffer.from('send_packet_commitment')]);
    const bufferSeq = Buffer.alloc(8);
    bufferSeq.writeBigUInt64BE(seq);
    const key = Buffer.concat([namespace, bufferSeq]);
    const path = Buffer.concat([Buffer.from([0x03]), Buffer.from(contractBech.data), key]);
    const res = await queryClient.queryRawProof('wasm', path, proven_height);
    const existProofs = res.proof.ops.slice(0, 2).map((op) => {
        const commitmentProof = CommitmentProof.decode(op.data);
        return ExistenceProof.toJSON(commitmentProof?.exist!);
    });
    return existProofs;
}

export async function getAckPacketProofs(
    queryClient: QueryClient,
    contract: string,
    proven_height: number,
    seq: bigint,
) {
    const contractBech = fromBech32(contract);
    const namespace = encodeNamespaces([Buffer.from('ack_commitment')]);
    const bufferSeq = Buffer.alloc(8);
    bufferSeq.writeBigUInt64BE(seq);
    const key = Buffer.concat([namespace, bufferSeq]);
    const path = Buffer.concat([Buffer.from([0x03]), Buffer.from(contractBech.data), key]);
    const res = await queryClient.queryRawProof('wasm', path, proven_height);
    console.log(Buffer.from(res.value).toString());
    const existProofs = res.proof.ops.slice(0, 2).map((op) => {
        const commitmentProof = CommitmentProof.decode(op.data);
        return ExistenceProof.toJSON(commitmentProof?.exist!);
    });
    return existProofs;
}

export const createUpdateClientData = async (
    rpcUrl: string,
    height: number,
): Promise<LightClientData> => {
    const tendermintClient = await Tendermint34Client.connect(rpcUrl);
    const [
        {
            block: { lastCommit },
        },
        {
            block: { header, txs },
        },
        { validators },
    ] = await Promise.all([
        tendermintClient.block(height + 1),
        tendermintClient.block(height),
        tendermintClient.validators({
            height,
            per_page: 100,
        }),
    ]);

    return {
        validators: validators.map(serializeValidator),
        lastCommit: serializeCommit(lastCommit!),
        header: serializeHeader(header),
        txs: txs.map((tx: any) => Buffer.from(tx).toString('hex')) as SerializedTx[],
    };
};

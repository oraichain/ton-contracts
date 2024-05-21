import {
    Address,
    Cell,
    Contract,
    ContractProvider,
    SendMode,
    Sender,
    Tuple,
    TupleItem,
    TupleItemInt,
    TupleItemSlice,
    beginCell,
    contractAddress,
} from '@ton/core';
import crypto from 'crypto';
import { crc32 } from '../crc32';
import { Any } from 'cosmjs-types/google/protobuf/any';

import { Fee, Tip, TxBody, ModeInfo_Single, SignerInfo, AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx';

const MAX_BYTES_CELL = 1023 / 8 - 1;

import { int64FromString, writeVarint64 } from 'cosmjs-types/varint';
import { CompactBitArray } from 'cosmjs-types/cosmos/crypto/multisig/v1beta1/multisig';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { DecodedTxRaw } from '@cosmjs/proto-signing';
import { sha256 } from '@cosmjs/crypto';

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

export type BlockId = {
    hash: string;
    parts: {
        hash: string;
        total: number;
    };
};

export type CanonicalVote = {
    type: number;
    height: number;
    round: number;
    block_id: BlockId;
    timestamp: string;
    chain_id: string;
};

export type TxBodyWasm = {
    messages: {
        typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract';
        value: MsgExecuteContract;
    }[];
    memo: string;
    timeoutHeight: number;
    extensionOptions: Any[];
    nonCriticalExtensionOptions: Any[];
};

export type TxWasm = {
    body: TxBodyWasm;
    authInfo: AuthInfo;
    signatures: string[];
};

export const Opcodes = {
    increase: crc32('op::increase'), //0x7e8764ef,
};

export const getTimeComponent = (timestampz: string) => {
    let millis = new Date(timestampz).getTime();
    let seconds = Math.floor(millis / 1000);

    // ghetto, we're pulling the nanoseconds from the string
    let withoutZone = timestampz.slice(0, -1);
    let nanosStr = withoutZone.split('.')[1] || '';
    let nanoseconds = Number(nanosStr.padEnd(9, '0'));
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

export const getTimeSlice = (timestampz: string): Cell => {
    const { seconds, nanoseconds } = getTimeComponent(timestampz);
    let cell = beginCell();
    cell = cell.storeUint(seconds < 0 ? 0 : seconds, 32).storeUint(nanoseconds < 0 ? 0 : nanoseconds, 32);

    return cell.endCell();
};

export const getInt64Slice = (modeInfo: ModeInfo_Single) => {
    const { lo, hi } = int64FromString(modeInfo.mode.toString());
    let buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    return beginCell().storeBuffer(Buffer.from(buff)).endCell();
};

export const getBlockSlice = (blockId: BlockId): Cell => {
    return beginCell()
        .storeUint(blockId.hash ? BigInt('0x' + blockId.hash) : 0n, 256)
        .storeUint(blockId.parts.hash ? BigInt('0x' + blockId.parts.hash) : 0n, 256)
        .storeUint(blockId.parts.total, 8)
        .endCell();
};

export const getCanonicalVoteSlice = (vote: CanonicalVote): Cell => {
    return beginCell()
        .storeUint(vote.type, 32)
        .storeUint(vote.height, 32)
        .storeUint(vote.round, 32)
        .storeRef(getBlockSlice(vote.block_id))
        .storeRef(getTimeSlice(vote.timestamp))
        .storeRef(beginCell().storeBuffer(Buffer.from(vote.chain_id)).endCell())
        .endCell();
};

export const getSignInfoCell = (mode: SignerInfo): Cell => {
    const typeUrl = beginCell().storeBuffer(Buffer.from(mode!.publicKey!.typeUrl)).endCell();
    const value = buildRecursiveSliceRef(mode!.publicKey!.value);
    const anyCell = beginCell()
        .storeRef(typeUrl)
        .storeRef(value || beginCell().endCell())
        .endCell();
    const modeInfo = mode.modeInfo?.single ? getInt64Slice(mode.modeInfo?.single) : beginCell().endCell();
    const { lo, hi } = int64FromString(mode.sequence.toString());
    let buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    const sequence = beginCell().storeBuffer(Buffer.from(buff)).endCell();
    const inputCell = beginCell().storeRef(anyCell).storeRef(modeInfo).storeRef(sequence).endCell();
    return inputCell;
};

export const getFeeCell = (fee: Fee): Cell => {
    const { lo, hi } = int64FromString(fee.gasLimit.toString());
    let buff = [] as number[];
    writeVarint64({ lo, hi }, buff, 0);
    let amountsCell;
    for (let i = fee.amount.length - 1; i >= 0; i--) {
        let innerCell = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(fee.amount[i].denom)).endCell())
            .storeRef(beginCell().storeBuffer(Buffer.from(fee.amount[i].amount)).endCell())
            .endCell();
        if (!amountsCell) {
            amountsCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            amountsCell = beginCell().storeRef(amountsCell).storeRef(innerCell).endCell();
        }
    }
    let inputRef = beginCell()
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
        let innerCell = beginCell()
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
    const branch: TupleItem[] = [];
    while (node.parent) {
        const isRight = node.parent.right!.value!.equals(node.value!);
        // left is 1, right is 0
        positions = positions.storeBit(isRight ? 1 : 0);
        branch.push({
            type: 'slice',
            cell: beginCell()
                .storeBuffer(isRight ? node.parent.left!.value! : node.parent.right!.value!)
                .endCell(),
        });
        node = node.parent;
    }

    return { root, branch, positions: positions.endCell() };
};

export const txBodyWasmToTuple = (txBodyWasm: TxBodyWasm) => {
    const txBodyTuple: TupleItem[] = [];
    const messagesTuple: TupleItem[] = txBodyWasm.messages.map((msg) => {
        return {
            type: 'tuple',
            items: [
                {
                    type: 'slice',
                    cell: beginCell().storeBuffer(Buffer.from(msg.typeUrl)).endCell(),
                },
                {
                    type: 'tuple',
                    items: msgExecuteContractToCell(msg.value) as any,
                },
            ],
        };
    });
    let memo_timeout_height_builder = beginCell();

    if (txBodyWasm.memo) {
        memo_timeout_height_builder.storeRef(beginCell().storeBuffer(Buffer.from(txBodyWasm.memo)).endCell());
    }

    if (txBodyWasm.timeoutHeight > 0n) {
        memo_timeout_height_builder.storeUint(txBodyWasm.timeoutHeight, 64);
    }

    const ext_opts_tuple = txBodyWasm.extensionOptions.map(anyToTuple) as any;
    const non_critical_ext_opts_tuple = txBodyWasm.nonCriticalExtensionOptions.map(anyToTuple) as any;

    txBodyTuple.push({ type: 'tuple', items: messagesTuple });
    txBodyTuple.push({ type: 'slice', cell: memo_timeout_height_builder.endCell() });
    txBodyTuple.push({ type: 'tuple', items: ext_opts_tuple });
    txBodyTuple.push({ type: 'tuple', items: non_critical_ext_opts_tuple });

    return txBodyTuple;
};

export const txBodyToTuple = (txBodyWasm: TxBody) => {
    let messagesCell;
    for (let i = txBodyWasm.messages.length - 1; i >= 0; i--) {
        const typeUrl = beginCell().storeBuffer(Buffer.from(txBodyWasm.messages[i].typeUrl)).endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.messages[i].value);
        let innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!messagesCell) {
            messagesCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            messagesCell = beginCell().storeRef(messagesCell).storeRef(innerCell).endCell();
        }
    }

    let memo_timeout_height_builder = beginCell();
    if (txBodyWasm.memo) {
        memo_timeout_height_builder.storeRef(beginCell().storeBuffer(Buffer.from(txBodyWasm.memo)).endCell());
    }

    if (txBodyWasm.timeoutHeight > 0n) {
        memo_timeout_height_builder.storeUint(txBodyWasm.timeoutHeight, 64);
    }

    let extCell;
    for (let i = txBodyWasm.extensionOptions.length - 1; i >= 0; i--) {
        const typeUrl = beginCell().storeBuffer(Buffer.from(txBodyWasm.extensionOptions[i].typeUrl)).endCell();
        const value = buildRecursiveSliceRef(txBodyWasm.extensionOptions[i].value);
        let innerCell = beginCell()
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
        let innerCell = beginCell()
            .storeRef(typeUrl)
            .storeRef(value || beginCell().endCell())
            .endCell();
        if (!nonExtCell) {
            nonExtCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            nonExtCell = beginCell().storeRef(nonExtCell).storeRef(innerCell).endCell();
        }
    }

    return [
        { type: 'slice', cell: messagesCell },
        { type: 'slice', cell: memo_timeout_height_builder.endCell() },
        { type: 'slice', cell: txBodyWasm.extensionOptions.length == 0 ? beginCell().endCell() : extCell },
        {
            type: 'slice',
            cell: txBodyWasm.nonCriticalExtensionOptions.length == 0 ? beginCell().endCell() : nonExtCell,
        },
    ];
};

export const msgExecuteContractToCell = (msg: MsgExecuteContract) => {
    const sender_contract = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(msg.sender)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(msg.contract)).endCell())
        .endCell();

    const msgToTuple = buildRecursiveSliceRef(msg.msg);

    let fundCell;
    for (let i = msg.funds.length - 1; i >= 0; i--) {
        let item = msg.funds[i];
        let innerCell = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
            .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
            .endCell();
        if (!fundCell) {
            fundCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            fundCell = beginCell().storeRef(fundCell).storeRef(innerCell).endCell();
        }
    }

    return [
        { type: 'slice', cell: sender_contract },
        { type: 'slice', cell: msgToTuple! },
        { type: 'slice', cell: msg.funds.length == 0 ? beginCell().endCell() : fundCell! },
    ];
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

export type Header = {
    version: Version;
    chain_id: string;
    height: string;
    time: string;
    last_block_id: BlockId;
};

export type Commit = {
    height: string;
    round: number;
    block_id: BlockId;
    signatures: Signature[];
};

export type Signature = {
    block_id_flag: number;
    validator_address: string;
    timestamp: string;
    signature: string | null;
};

export class TestClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TestClient(address);
    }

    static createFromConfig(config: TestClientConfig, code: Cell, workchain = 0) {
        const data = testClientConfigToCell(config);
        const init = { code, data };
        return new TestClient(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendIncrease(
        provider: ContractProvider,
        via: Sender,
        opts: {
            increaseBy: number;
            value: bigint;
            queryID?: number;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.increase, 32)
                .storeUint(opts.queryID ?? 0, 64)
                .storeUint(opts.increaseBy, 32)
                .endCell(),
        });
    }

    async getCounter(provider: ContractProvider) {
        const result = await provider.get('get_counter', []);
        return result.stack.readNumber();
    }

    async getID(provider: ContractProvider) {
        const result = await provider.get('get_id', []);
        return result.stack.readNumber();
    }

    async getEncode(provider: ContractProvider, value: bigint) {
        const result = await provider.get('get_encode_uint', [
            {
                type: 'int',
                value,
            } as TupleItemInt,
        ]);
        return result.stack.readBuffer();
    }

    async getEncodeLength(provider: ContractProvider, value: bigint) {
        const result = await provider.get('get_encode_uint_length', [
            {
                type: 'int',
                value,
            } as TupleItemInt,
        ]);
        return result.stack.readNumber();
    }

    async getBufferEncodeLength(provider: ContractProvider, buf: Buffer) {
        const result = await provider.get('get_buffer_encode_length', [
            {
                type: 'slice',
                cell: beginCell().storeBuffer(buf).endCell(),
            } as TupleItemSlice,
        ]);
        return result.stack.readNumber();
    }

    async getBufferEncode(provider: ContractProvider, buf: Buffer) {
        const result = await provider.get('get_buffer_encode', [
            {
                type: 'slice',
                cell: beginCell().storeBuffer(buf).endCell(),
            } as TupleItemSlice,
        ]);
        return result.stack.readBuffer();
    }

    async getCheckSignature(provider: ContractProvider, data: Buffer, signature: Buffer, publicKey: Buffer) {
        const result = await provider.get('get_check_signature', [
            {
                type: 'slice',
                cell: beginCell().storeBuffer(data).endCell(),
            } as TupleItemSlice,
            {
                type: 'slice',
                cell: beginCell().storeBuffer(signature).endCell(),
            } as TupleItemSlice,
            {
                type: 'int',
                value: BigInt(`0x${publicKey.subarray(0, 32).toString('hex')}`),
            } as TupleItemInt,
        ]);
        return result.stack.readNumber() !== 0;
    }

    async getHashTreeRoot(provider: ContractProvider, leaves: Buffer[]) {
        let innerCell;
        for (let i = leaves.length - 1; i >= 0; --i) {
            if (!innerCell) {
                innerCell = beginCell().storeBuffer(leaves[i]).endCell();
            } else {
                innerCell = beginCell().storeRef(innerCell).storeBuffer(leaves[i]).endCell();
            }
        }

        const result = await provider.get('get_tree_root_from_slice_refs', [
            {
                type: 'slice',
                cell: innerCell!,
            },
            {
                type: 'int',
                value: BigInt(leaves.length),
            },
        ]);

        return result.stack.readBigNumber();
    }

    async getHashFromTreeProof(provider: ContractProvider, leaves: Buffer[], leafData: Buffer) {
        const { branch, positions } = getMerkleProofs(leaves, leafData);
        console.log(branch);
        console.log(positions);
        const leaf = BigInt('0x' + leafHash(leafData).toString('hex'));
        const result = await provider.get('get_tree_root_from_proof', [
            {
                type: 'int',
                value: leaf,
            },
            {
                type: 'tuple',
                items: branch,
            },
            {
                type: 'slice',
                cell: positions,
            },
        ]);

        return result.stack.readBigNumber();
    }

    async getDigestHash(provider: ContractProvider, longBuf: Buffer) {
        const items: TupleItem[] = [];

        for (let i = 0; i < longBuf.length; i += 127) {
            items.push({
                type: 'slice',
                cell: beginCell()
                    .storeBuffer(longBuf.subarray(i, Math.min(longBuf.length, i + 127)))
                    .endCell(),
            });
        }

        const result = await provider.get('digest', [
            {
                type: 'tuple',
                items,
            },
        ]);

        return result.stack.readBigNumber();
    }

    // Version testing
    async getVersionEncodingLength(provider: ContractProvider, version: Version) {
        const result = await provider.get('version_encode_length', [
            {
                type: 'slice',
                cell: getVersionSlice(version),
            },
        ]);
        return result.stack.readNumber();
    }

    async getVersionEncode(provider: ContractProvider, version: Version) {
        const result = await provider.get('version_encode', [
            {
                type: 'slice',
                cell: getVersionSlice(version),
            },
        ]);
        return result.stack.readBuffer();
    }

    // Time
    async getTimeEncodeLength(provider: ContractProvider, timestampz: string) {
        const result = await provider.get('time_encode_length', [
            {
                type: 'slice',
                cell: getTimeSlice(timestampz),
            },
        ]);
        return result.stack.readNumber();
    }

    // TestClient testing
    async getBlockIdEncodingLength(provider: ContractProvider, lastBlockId: BlockId) {
        const result = await provider.get('blockid_encoding_length', [
            {
                type: 'slice',
                cell: getBlockSlice(lastBlockId),
            },
        ]);
        return result.stack.readNumber();
    }

    async getBlockIdEncode(provider: ContractProvider, lastBlockId: BlockId) {
        const result = await provider.get('blockid_encode', [
            {
                type: 'slice',
                cell: getBlockSlice(lastBlockId),
            },
        ]);
        return result.stack.readBuffer();
    }

    async getTimeEncode(provider: ContractProvider, timestamp: string) {
        const result = await provider.get('time_encode', [
            {
                type: 'slice',
                cell: getTimeSlice(timestamp),
            },
        ]);
        return result.stack.readBuffer();
    }

    async getBlockHash(provider: ContractProvider, header: any) {
        let cell = beginCell()
            .storeRef(getVersionSlice(header.version))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.chain_id)).endCell())
            .storeUint(header.height, 32)
            .storeRef(getTimeSlice(header.time))
            .storeRef(getBlockSlice(header.last_block_id))
            .storeBuffer(Buffer.from(header.proposer_address, 'hex'));

        let hashCell1 = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(header.last_commit_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.data_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.validators_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.next_validators_hash, 'hex')));

        let hashCell2 = beginCell()
            .storeRef(beginCell().storeBuffer(Buffer.from(header.consensus_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.app_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.last_results_hash, 'hex')))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.evidence_hash, 'hex')));

        let dsCell = beginCell().storeRef(cell).storeRef(hashCell1).storeRef(hashCell2).endCell();
        const result = await provider.get('get_block_hash', [
            {
                type: 'slice',
                cell: dsCell,
            },
        ]);

        // 1CCCF41BAB3DD153852B4C59A2194EB90A210E2FF585CC60ED07EBA71B4D5D27
        return result.stack.readBigNumber();
    }

    async getUint64LEEncode(provider: ContractProvider, value: bigint | number) {
        const result = await provider.get('uint64le_encode', [
            {
                type: 'int',
                value: BigInt(value),
            },
        ]);
        return result.stack.readBuffer();
    }

    async getCanonicalVoteEncode(provider: ContractProvider, vote: CanonicalVote) {
        const voteCell = getCanonicalVoteSlice(vote);
        const result = await provider.get('canonical_vote_encode', [
            {
                type: 'slice',
                cell: voteCell,
            },
        ]);
        return result.stack.readBuffer();
    }

    // Pubkey
    async getPubkeyEncode(provider: ContractProvider, pubkey: string) {
        let pubkeyBuffer = Buffer.from(pubkey, 'base64');
        const result = await provider.get('pubkey_encode', [
            {
                type: 'slice',
                cell: beginCell().storeBuffer(pubkeyBuffer).endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }

    // Validator Hash Input
    async getValidatorHashInputEncode(provider: ContractProvider, pubkey: string, votingPower: number) {
        let pubkeyBuffer = Buffer.from(pubkey, 'base64');
        const result = await provider.get('validator_hash_input_encode', [
            {
                type: 'slice',
                cell: beginCell().storeBuffer(pubkeyBuffer).storeUint(votingPower, 32).endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }

    async getVoteSignBytes(provider: ContractProvider, vote: CanonicalVote) {
        const voteCell = getCanonicalVoteSlice(vote);
        const result = await provider.get('get_vote_sign_bytes', [
            {
                type: 'slice',
                cell: voteCell,
            },
        ]);
        return result.stack.readBuffer();
    }

    async getVerifyVote(provider: ContractProvider, vote: CanonicalVote, signature: Buffer, publicKey: Buffer) {
        const data = getCanonicalVoteSlice(vote);
        const result = await provider.get('verify_vote', [
            {
                type: 'slice',
                cell: data,
            } as TupleItemSlice,
            {
                type: 'slice',
                cell: beginCell().storeBuffer(signature).endCell(),
            } as TupleItemSlice,
            {
                type: 'int',
                value: BigInt(`0x${publicKey.subarray(0, 32).toString('hex')}`),
            } as TupleItemInt,
        ]);

        return result.stack.readNumber() !== 0;
    }

    async getVerifyCommitSigs(provider: ContractProvider, header: Header, commit: Commit, validators: Validators[]) {
        const sliceHeader = beginCell()
            .storeUint(parseInt(header.height), 32)
            .storeRef(getVersionSlice(header.version))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.chain_id)).endCell())
            .storeRef(getTimeSlice(header.time))
            .storeRef(getBlockSlice(header.last_block_id))
            .endCell();

        let signatureCell;
        for (let i = commit.signatures.length - 1; i >= 0; i--) {
            let signature = commit.signatures[i];
            let cell = beginCell()
                .storeUint(signature.block_id_flag, 8)
                .storeBuffer(Buffer.from(signature.validator_address, 'hex'))
                .storeRef(getTimeSlice(signature.timestamp))
                .storeBuffer(signature.signature ? Buffer.from(signature.signature, 'base64') : Buffer.from(''))
                .endCell();
            if (!signatureCell) {
                signatureCell = beginCell().storeRef(beginCell().endCell()).storeRef(cell).endCell();
            } else {
                signatureCell = beginCell().storeRef(signatureCell).storeRef(cell).endCell();
            }
        }
        console.log(signatureCell);

        let commitCell = beginCell()
            .storeUint(BigInt(commit.height), 32)
            .storeUint(BigInt(commit.round), 32)
            .storeRef(getBlockSlice(commit.block_id))
            .storeRef(signatureCell!)
            .endCell();

        let validatorCell;
        for (let i = validators.length - 1; i >= 0; i--) {
            let builder = beginCell().storeBuffer(Buffer.from(validators[i].address, 'hex'));
            if (validators[i]?.pub_key?.value) {
                builder = builder.storeRef(
                    beginCell()
                        .storeBuffer(Buffer.from(validators[i].pub_key.value as string, 'base64'))
                        .endCell(),
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
            builder = builder.storeUint(parseInt(validators[i].voting_power), 32);
            let innerCell = builder.endCell();
            if (!validatorCell) {
                validatorCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
            } else {
                validatorCell = beginCell().storeRef(validatorCell).storeRef(innerCell).endCell();
            }
        }

        const result = await provider.get('verify_commit_sigs', [
            {
                type: 'slice',
                cell: sliceHeader,
            },
            {
                type: 'slice',
                cell: commitCell,
            },
            {
                type: 'slice',
                cell: validatorCell!,
            },
        ]);
        return result.stack.readNumber();
    }

    async getAnyEncode(provider: ContractProvider, message: any) {
        const typeUrl = beginCell().storeBuffer(Buffer.from(message.typeUrl)).endCell();
        const value = buildRecursiveSliceRef(message.value);

        const result = await provider.get('any_encode', [
            {
                type: 'slice',
                cell: beginCell()
                    .storeRef(typeUrl)
                    .storeRef(value || beginCell().endCell())
                    .endCell(),
            },
        ]);

        return result.stack.readTuple();
    }

    async getCompactBitArrayEncode(provider: ContractProvider, data: CompactBitArray) {
        const value = buildSliceTupleFromUint8Array(data.elems);

        const result = await provider.get('compact_bit_array_encode', [
            {
                type: 'tuple',
                items: [
                    { type: 'int', value: BigInt(data.extraBitsStored) },
                    { type: 'tuple', items: value },
                ],
            },
        ]);

        return result.stack.readTuple();
    }

    async getCompactBitArrayEncodeLength(provider: ContractProvider, data: CompactBitArray) {
        const value = buildSliceTupleFromUint8Array(data.elems);

        const result = await provider.get('compact_bit_array_encode_length', [
            {
                type: 'tuple',
                items: [
                    { type: 'int', value: BigInt(data.extraBitsStored) },
                    { type: 'tuple', items: value },
                ],
            },
        ]);

        return result.stack.readNumber();
    }

    // get coin encode
    async getCoinEncode(provider: ContractProvider, denom: string, amount: string) {
        let denomBuffer = Buffer.from(denom);
        let amountBuffer = Buffer.from(amount);
        const result = await provider.get('coin_encode', [
            {
                type: 'slice',
                cell: beginCell()
                    .storeRef(beginCell().storeBuffer(denomBuffer).endCell())
                    .storeRef(beginCell().storeBuffer(amountBuffer).endCell())
                    .endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }

    // fee
    async getFeeEncode(provider: ContractProvider, fee: Fee) {
        const cell = getFeeCell(fee);
        const result = await provider.get('fee_encode', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readBuffer();
    }

    async getFeeEncodeLength(provider: ContractProvider, fee: Fee) {
        const cell = getFeeCell(fee);
        const result = await provider.get('fee_encode_length', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readNumber();
    }

    // TxBody
    async getTxBody(provider: ContractProvider, txBody: TxBody) {
        const input = txBodyToTuple(txBody) as TupleItem[];
        const result = await provider.get('tx_body_encode', input);

        return result.stack.readTuple();
    }

    // tip
    async getTipEncode(provider: ContractProvider, tip: Tip) {
        const cell = getTipCell(tip);
        const result = await provider.get('tip_encode', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readBuffer();
    }

    async getTipEncodeLength(provider: ContractProvider, tip: Tip) {
        const cell = getTipCell(tip);
        const result = await provider.get('tip_encode_length', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readNumber();
    }

    // mode
    async getModeInfoEncode(provider: ContractProvider, modeInfo: ModeInfo_Single) {
        const { lo, hi } = int64FromString(modeInfo.mode.toString());
        let buff = [] as number[];
        writeVarint64({ lo, hi }, buff, 0);
        const result = await provider.get('mode_info_encode', [
            {
                type: 'slice',
                cell:
                    modeInfo.mode === 0 ? beginCell().endCell() : beginCell().storeBuffer(Buffer.from(buff)).endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }

    async getModeInfoEncodeLength(provider: ContractProvider, modeInfo: ModeInfo_Single) {
        const result = await provider.get('mode_info_encode_length', [
            {
                type: 'slice',
                cell: modeInfo.mode === 0 ? beginCell().endCell() : getInt64Slice(modeInfo),
            },
        ]);
        return result.stack.readNumber();
    }

    async getSignerInfoEncode(provider: ContractProvider, mode: SignerInfo) {
        const cell = getSignInfoCell(mode);
        const result = await provider.get('signer_info_encode', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readTuple();
    }

    async getSignerInfoEncodeLength(provider: ContractProvider, mode: SignerInfo) {
        const cell = getSignInfoCell(mode);
        const result = await provider.get('signer_info_encode_length', [
            {
                type: 'slice',
                cell,
            },
        ]);
        return result.stack.readNumber();
    }

    async getAuthInfoEncode(provider: ContractProvider, data: AuthInfo) {
        var { signInfos, fee, tip } = getAuthInfoInput(data);

        const result = await provider.get('auth_info_encode', [
            {
                type: 'slice',
                cell: signInfos!,
            },
            {
                type: 'slice',
                cell: fee,
            },
            {
                type: 'slice',
                cell: tip,
            },
        ]);
        return result.stack.readTuple();
    }

    async getMsgExecuteContract(provider: ContractProvider, msg: MsgExecuteContract) {
        const input = msgExecuteContractToCell(msg) as TupleItem[];
        const result = await provider.get('msg_execute_contract_encode', input);
        return result.stack.readTuple();
    }

    async getAuthInfoEncodeLength(provider: ContractProvider, data: AuthInfo) {
        var { signInfos, fee, tip } = getAuthInfoInput(data);

        const result = await provider.get('auth_info_encode_length', [
            {
                type: 'slice',
                cell: signInfos!,
            },
            {
                type: 'slice',
                cell: fee,
            },
            {
                type: 'slice',
                cell: tip,
            },
        ]);
        return result.stack.readNumber();
    }

    async getVerifyTx(provider: ContractProvider, tx: TxWasm, leaves: Buffer[], leafData: Buffer) {
        const { signInfos, fee, tip } = getAuthInfoInput(tx.authInfo);
        const txBody = txBodyWasmToTuple(tx.body);
        const signatures: TupleItem[] = tx.signatures.map((item) => {
            return {
                type: 'slice',
                cell: beginCell().storeBuffer(Buffer.from(item)).endCell(),
            };
        });
        const { branch: proofs, positions } = getMerkleProofs(leaves, leafData);

        const result = await provider.get('verify_tx', [
            {
                type: 'tuple',
                items: proofs,
            },
            {
                type: 'slice',
                cell: positions,
            },
            {
                type: 'slice',
                cell: beginCell()
                    .storeUint(BigInt('0x' + '9e70c46eda6841ed6ede4ae280d2cd2683dc103b9568f63f06f04e9d7e0617f0'), 256)
                    .endCell(),
            },
            {
                type: 'tuple',
                items: [
                    {
                        type: 'tuple',
                        items: signInfos as any,
                    },
                    fee as any, // FIXME
                    tip as any, // FIXME
                ],
            },
            {
                type: 'tuple',
                items: txBody,
            },
            {
                type: 'tuple',
                items: signatures,
            },
        ]);

        return result.stack.readNumber();
    }

    async getDecodedTxRaw(provider: ContractProvider, tx: TxWasm) {
        const { signInfos, fee, tip } = getAuthInfoInput(tx.authInfo);

        const txBody = txBodyWasmToTuple(tx.body);
        const signatures: TupleItem[] = tx.signatures.map((item) => {
            return {
                type: 'slice',
                cell: beginCell().storeBuffer(Buffer.from(item)).endCell(),
            };
        });

        const result = await provider.get('tx_raw_encode', [
            {
                type: 'tuple',
                items: [
                    {
                        type: 'tuple',
                        items: signInfos as any,
                    },
                    fee as any, // FIXME
                    tip as any, // FIXME
                ],
            },
            {
                type: 'tuple',
                items: txBody,
            },
            {
                type: 'tuple',
                items: signatures,
            },
        ]);

        return result.stack.readTuple();
    }

    async getTxHash(provider: ContractProvider, tx: TxWasm) {
        const { signInfos, fee, tip } = getAuthInfoInput(tx.authInfo);

        const txBody = txBodyWasmToTuple(tx.body);
        const signatures: TupleItem[] = tx.signatures.map((item) => {
            return {
                type: 'slice',
                cell: beginCell().storeBuffer(Buffer.from(item)).endCell(),
            };
        });

        const result = await provider.get('tx_hash', [
            {
                type: 'slice',
                cell: signInfos!,
            },
            {
                type: 'tuple',
                items: txBody,
            },
            {
                type: 'tuple',
                items: signatures,
            },
        ]);

        return result.stack.readBigNumber();
    }
}

function getAuthInfoInput(data: AuthInfo) {
    let finalSignInfosCell;
    for (let i = data.signerInfos.length - 1; i >= 0; i--) {
        let innerCell = getSignInfoCell(data.signerInfos[i]);
        if (!finalSignInfosCell) {
            finalSignInfosCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            finalSignInfosCell = beginCell().storeRef(finalSignInfosCell!).storeRef(innerCell).endCell();
        }
    }
    let fee = beginCell().endCell();
    if (data.fee) {
        fee = getFeeCell(data.fee) as any;
    }
    let tip = beginCell().endCell();
    if (data.tip) {
        tip = getTipCell(data.tip) as any;
    }
    return { signInfos: finalSignInfosCell, fee, tip };
}

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
import { Fee, Tip } from 'cosmjs-types/cosmos/tx/v1beta1/tx';

const MAX_BYTES_CELL = 1023 / 8 - 1;

import { Fee, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { int64FromString, writeVarint64 } from 'cosmjs-types/varint';
import { CompactBitArray } from 'cosmjs-types/cosmos/crypto/multisig/v1beta1/multisig';

export type LightClientConfig = {
    id: number;
    counter: number;
};

export function lightClientConfigToCell(config: LightClientConfig): Cell {
    return beginCell().storeUint(config.id, 32).storeUint(config.counter, 32).endCell();
}

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

export type Version = {
    block: string | number;
    app?: string | number;
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
    cell = cell.storeUint(seconds, 32).storeUint(nanoseconds, 32);

    return cell.endCell();
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

export const buildCellTuple = (value: string | Uint8Array) => {
    const tupleCell: TupleItem[] = [];
    let longBuf = Buffer.from(value);
    if(typeof value === 'string'){
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

export const anyToTuple = (value: Any)=>{
    const tupleAny: TupleItem[] = [];

    const typeUrlSlice: TupleItemSlice = {
        type: 'slice',
        cell: beginCell().storeBuffer(Buffer.from(value.typeUrl)).endCell()
    }
    
    tupleAny.push(typeUrlSlice);
    tupleAny.push({type:'tuple', items: buildCellTuple(value.value)});

    return tupleAny
}

export const txBodyToTuple = (txBody: TxBody)=>{
    const txBodyTuple: TupleItem[] = [];
    const messagesTuple = txBody.messages.map(anyToTuple);
    console.log(messagesTuple)
    const memo_timeout_height_slice = beginCell()
                                .storeRef(beginCell().storeBuffer(Buffer.from(txBody.memo)).endCell())
                                .storeUint(txBody.timeoutHeight, 64)
                                .endCell();
    const ext_opts_tuple = txBody.extensionOptions.map(anyToTuple) as any;
    const non_critical_ext_opts_tuple = txBody.nonCriticalExtensionOptions.map(anyToTuple) as any;

    txBodyTuple.push({type:'tuple', items: messagesTuple});
    // txBodyTuple.push({type:'slice', cell: memo_timeout_height_slice});
    // txBodyTuple.push({type:'tuple', items: ext_opts_tuple});
    // txBodyTuple.push({type:'tuple', items: non_critical_ext_opts_tuple});
    
    return txBodyTuple;
}

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

export class LightClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LightClient(address);
    }

    static createFromConfig(config: LightClientConfig, code: Cell, workchain = 0) {
        const data = lightClientConfigToCell(config);
        const init = { code, data };
        return new LightClient(contractAddress(workchain, init), init);
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

    async getHashTreeRoot(provider: ContractProvider, txs: string[]) {
        let builder = beginCell();

        for (const tx of txs) {
            builder = builder.storeBuffer(crypto.createHash('sha256').update(Buffer.from(tx, 'base64')).digest());
        }

        const result = await provider.get('get_tree_root', [
            {
                type: 'slice',
                cell: builder.endCell(),
            } as TupleItemSlice,
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
            } as Tuple,
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

    // LightClient testing
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
        const result = await provider.get('get_block_hash', [
            {
                type: 'slice',
                cell: cell.endCell(),
            },
            {
                type: 'slice',
                cell: hashCell1.endCell(),
            },
            {
                type: 'slice',
                cell: hashCell2.endCell(),
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
            .storeRef(getVersionSlice(header.version))
            .storeRef(beginCell().storeBuffer(Buffer.from(header.chain_id)).endCell())
            .storeUint(parseInt(header.height), 32)
            .storeRef(getTimeSlice(header.time))
            .storeRef(getBlockSlice(header.last_block_id))
            .endCell();

        const tupleSignatures = commit.signatures
            .filter((sig) => sig.signature)
            .map((signature) => {
                return {
                    type: 'slice',
                    cell: beginCell()
                        .storeUint(signature.block_id_flag, 8)
                        .storeBuffer(Buffer.from(signature.validator_address, 'hex'))
                        .storeRef(getTimeSlice(signature.timestamp))
                        .storeBuffer(signature.signature ? Buffer.from(signature.signature, 'base64') : Buffer.from(''))
                        .endCell(),
                } as TupleItemSlice;
            });

        const tupleCommit: TupleItem[] = [
            {
                type: 'int',
                value: BigInt(commit.height),
            },
            {
                type: 'int',
                value: BigInt(commit.round),
            },
            {
                type: 'slice',
                cell: getBlockSlice(commit.block_id),
            },
            {
                type: 'tuple',
                items: tupleSignatures,
            },
        ];

        const tupleValidators = validators.map((validators) => {
            let builder = beginCell().storeBuffer(Buffer.from(validators.address, 'hex'));
            if (validators?.pub_key?.value) {
                builder = builder.storeRef(
                    beginCell().storeBuffer(Buffer.from(validators.pub_key.value, 'base64')).endCell(),
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
            builder = builder.storeUint(parseInt(validators.voting_power), 32);
            return {
                type: 'slice',
                cell: builder.endCell(),
            } as TupleItemSlice;
        });

        const result = await provider.get('verify_commit_sigs', [
            {
                type: 'slice',
                cell: sliceHeader,
            },
            {
                type: 'tuple',
                items: tupleCommit,
            },
            {
                type: 'tuple',
                items: tupleValidators,
            },
        ]);
        return result.stack.readNumber();
    }

    async getAnyEncode(provider: ContractProvider, message: any) {
        const typeUrl = beginCell().storeBuffer(Buffer.from(message.typeUrl)).endCell();
        const value = buildCellTuple(message.value);

        const result = await provider.get('any_encode', [
            {
                type: 'slice',
                cell: typeUrl,
            } as TupleItemSlice,
            {
                type: 'tuple',
                items: value,
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
        const { lo, hi } = int64FromString(fee.gasLimit.toString());
        let buff = [] as number[];
        writeVarint64({ lo, hi }, buff, 0);
        console.log(lo === 0, hi === 0);
        const amounts = fee.amount.map((item) => {
            return {
                type: 'slice',
                cell: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
                    .endCell(),
            } as TupleItemSlice;
        });
        const result = await provider.get('fee_encode', [
            {
                type: 'tuple',
                items: [
                    { type: 'tuple', items: amounts },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(buff)).endCell(),
                    },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(fee.payer)).endCell(),
                    } as TupleItemSlice,
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(fee.granter)).endCell(),
                    } as TupleItemSlice,
                ],
            },
        ]);
        return result.stack.readBuffer();
    }

    async getFeeEncodeLength(provider: ContractProvider, fee: Fee) {
        const { lo, hi } = int64FromString(fee.gasLimit.toString());
        let buff = [] as number[];
        writeVarint64({ lo, hi }, buff, 0);
        const amounts = fee.amount.map((item) => {
            return {
                type: 'slice',
                cell: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
                    .endCell(),
            } as TupleItemSlice;
        });
        const result = await provider.get('fee_encode_length', [
            {
                type: 'tuple',
                items: [
                    { type: 'tuple', items: amounts },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(buff)).endCell(),
                    },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(fee.payer)).endCell(),
                    } as TupleItemSlice,
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(fee.granter)).endCell(),
                    } as TupleItemSlice,
                ],
            },
        ]);
        return result.stack.readNumber();
    }

    // TxBody
    async getTxBody(provider: ContractProvider, txBody: TxBody){
        const input = txBodyToTuple(txBody);

        console.log(input);

        const result = await provider.get('tx_body_encode', input);

        // return result.stack.readTuple();
    }

    // tip
    async getTipEncode(provider: ContractProvider, tip: Tip) {
        const amounts = tip.amount.map((item) => {
            return {
                type: 'slice',
                cell: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
                    .endCell(),
            } as TupleItemSlice;
        });
        const result = await provider.get('tip_encode', [
            {
                type: 'tuple',
                items: [
                    { type: 'tuple', items: amounts },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(tip.tipper)).endCell(),
                    } as TupleItemSlice,
                ],
            },
        ]);
        return result.stack.readBuffer();
    }

    async getTipEncodeLength(provider: ContractProvider, tip: Tip) {
        const amounts = tip.amount.map((item) => {
            return {
                type: 'slice',
                cell: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.denom)).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from(item.amount)).endCell())
                    .endCell(),
            } as TupleItemSlice;
        });
        const result = await provider.get('tip_encode_length', [
            {
                type: 'tuple',
                items: [
                    { type: 'tuple', items: amounts },
                    {
                        type: 'slice',
                        cell: beginCell().storeBuffer(Buffer.from(tip.tipper)).endCell(),
                    } as TupleItemSlice,
                ],
            },
        ]);
        return result.stack.readNumber();
    }
}

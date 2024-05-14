import {
    Address,
    Cell,
    Contract,
    ContractProvider,
    SendMode,
    Sender,
    TupleItem,
    TupleItemInt,
    TupleItemSlice,
    beginCell,
    contractAddress,
} from '@ton/core';
import crypto from 'crypto';
import { crc32 } from '../crc32';
import { CoinType } from '@oraichain/oraidex-common';

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

    // Version testing
    async get__version__encodingLength(provider: ContractProvider, version: Version) {
        const result = await provider.get('version_encode_length', [
            {
                type: 'slice',
                cell: getVersionSlice(version),
            },
        ]);
        return result.stack.readNumber();
    }

    async get__version__encode(provider: ContractProvider, version: Version) {
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
    async get__blockid__encodingLength(provider: ContractProvider, lastBlockId: BlockId) {
        const result = await provider.get('blockid_encoding_length', [
            {
                type: 'slice',
                cell: getBlockSlice(lastBlockId),
            },
        ]);
        return result.stack.readNumber();
    }

    async get__blockid__encode(provider: ContractProvider, lastBlockId: BlockId) {
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

    async get__UInt64LE__encode(provider: ContractProvider, value: bigint | number) {
        const result = await provider.get('uint64le_encode', [
            {
                type: 'int',
                value: BigInt(value),
            },
        ]);
        return result.stack.readBuffer();
    }

    async get__CanonicalVote__encode(provider: ContractProvider, vote: CanonicalVote) {
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
    async get__Pubkey__encode(provider: ContractProvider, pubkey: string) {
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
    async get__ValidatorHashInput__encode(provider: ContractProvider, pubkey: string, votingPower: number) {
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

    // get coin encode
    async get__Coin__encode(provider: ContractProvider, denom: string, amount: string) {
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
}

import {
    Address,
    Cell,
    Contract,
    ContractProvider,
    SendMode,
    Sender,
    TupleItemInt,
    TupleItemSlice,
    beginCell,
    contractAddress,
} from '@ton/core';
import crypto from 'crypto';
import { crc32 } from '../crc32';

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
    block: number;
    app?: number;
};
export const getVersionSlice = (version: Version): Cell => {
    let cell = beginCell();
    cell = cell.storeUint(version.block, 32);
    if (version.app) {
        cell = cell.storeUint(version.app, 32);
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
    let hashBuffer = Buffer.from(blockId.hash, 'hex');
    let hash = beginCell();
    for (const item of hashBuffer) {
        hash.storeUint(item, 8);
    }
    let partHashBuffer = Buffer.from(blockId.parts.hash, 'hex');
    let partHash = beginCell();
    for (const item of partHashBuffer) {
        partHash.storeUint(item, 8);
    }

    let parts = beginCell().storeUint(blockId.parts.total, 32).storeRef(partHash.endCell());
    return beginCell().storeRef(hash.endCell()).storeRef(parts.endCell()).endCell();
};

export const getCanonicalVoteSlice = (vote: CanonicalVote): Cell => {
    return beginCell()
        .storeInt(vote.type, 32)
        .storeInt(vote.height, 32)
        .storeInt(vote.round, 32)
        .storeRef(getBlockSlice(vote.block_id))
        .storeRef(getTimeSlice(vote.timestamp))
        .storeRef(beginCell().storeBuffer(Buffer.from(vote.chain_id)).endCell())
        .endCell();
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

    async getHashTreeRoot(provider: ContractProvider, txs: Buffer[]) {
        let builder = beginCell();

        for (const tx of txs) {
            builder = builder.storeBuffer(crypto.createHash('sha256').update(tx).digest());
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

    // Cell testing
    async get__cell__writeCellByOffset(provider: ContractProvider, src: Cell, dst: Cell, offset: number) {
        const result = await provider.get('cell_write_cell_by_offset', [
            {
                type: 'cell',
                cell: src,
            },
            {
                type: 'cell',
                cell: dst,
            },
            {
                type: 'int',
                value: BigInt(offset),
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

    async getTimeEncode(provider: ContractProvider, timestampz: string) {
        const { seconds, nanoseconds } = getTimeComponent(timestampz);
        let cell = beginCell();
        cell = cell.storeUint(seconds, 32).storeUint(nanoseconds, 32);

        const result = await provider.get('time_encode', [
            {
                type: 'slice',
                cell: getTimeSlice(timestampz),
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

    async get__Int64LE__encode(provider: ContractProvider, value: bigint | number) {
        let cell = beginCell();
        cell = cell.storeInt(value, 64);
        const result = await provider.get('int64le_encode', [
            {
                type: 'slice',
                cell: cell.endCell(),
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
}

import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    crc32c,
    TupleItemSlice,
    TupleItemInt,
    TupleItemCell,
    Builder,
} from '@ton/core';
import crypto from 'crypto';
import { crc32 } from '../crc32';
import { convertStringToUint8Array } from './helpers/hex';

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

export const getTimeSlice = (timestampz: string): Cell => {
    const { seconds, nanoseconds } = getTimeComponent(timestampz);

    let cell = beginCell();
    cell = cell.storeUint(seconds, 32).storeUint(nanoseconds, 32);

    return cell.endCell();
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
    async get__version__encodingLength(provider: ContractProvider, block: number, app?: number) {
        let cell = beginCell();
        cell = cell.storeUint(block, 32);
        if (app) {
            cell = cell.storeUint(app, 32);
        }

        const result = await provider.get('version_encode_length', [
            {
                type: 'slice',
                cell: cell.endCell(),
            },
        ]);
        return result.stack.readNumber();
    }

    async get__version__encode(provider: ContractProvider, block: number, app?: number) {
        let cell = beginCell();
        cell = cell.storeUint(block, 32);
        if (app) {
            cell = cell.storeUint(app, 32);
        }

        const result = await provider.get('version_encode', [
            {
                type: 'slice',
                cell: cell.endCell(),
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
    async get__blockid__encodingLength(provider: ContractProvider, lastBlockId: any) {
        let hashBuffer = convertStringToUint8Array(lastBlockId.hash);
        let hash = beginCell();
        for (const item of hashBuffer) {
            hash.storeUint(item, 8);
        }
        let partHashBuffer = convertStringToUint8Array(lastBlockId.parts.hash);
        let partHash = beginCell();
        for (const item of partHashBuffer) {
            partHash.storeUint(item, 8);
        }

        let parts = beginCell().storeUint(lastBlockId.parts.total, 32).storeRef(partHash.endCell());
        let finalCell = beginCell().storeRef(hash.endCell()).storeRef(parts.endCell()).endCell();
        const result = await provider.get('blockid_encoding_length', [
            {
                type: 'slice',
                cell: finalCell,
            },
        ]);
        return result.stack.readNumber();
    }

    async get__blockid__encode(provider: ContractProvider, lastBlockId: any) {
        let hashBuffer = convertStringToUint8Array(lastBlockId.hash);
        let hash = beginCell();
        for (const item of hashBuffer) {
            hash.storeUint(item, 8);
        }
        let partHashBuffer = convertStringToUint8Array(lastBlockId.parts.hash);
        let partHash = beginCell();
        for (const item of partHashBuffer) {
            partHash.storeUint(item, 8);
        }

        let parts = beginCell().storeUint(lastBlockId.parts.total, 32).storeRef(partHash.endCell());
        let finalCell = beginCell().storeRef(hash.endCell()).storeRef(parts.endCell()).endCell();
        const result = await provider.get('blockid_encode', [
            {
                type: 'slice',
                cell: finalCell,
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
        let cell = beginCell();
        const versionCell = beginCell().storeUint(header.version.block, 32).endCell();
        const chainIdCell = beginCell().storeBuffer(Buffer.from(header.chain_id)).endCell();
        const timeCell = getTimeSlice(header.time);
        cell = cell.storeRef(versionCell).storeRef(chainIdCell).storeUint(header.height, 32).storeRef(timeCell);
        const result = await provider.get('get_block_hash', [
            {
                type: 'slice',
                cell: cell.endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }
}
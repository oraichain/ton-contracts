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

    async getEncode(provider: ContractProvider, value: bigint, signed: boolean = false) {
        const result = await provider.get('get_encode', [
            {
                type: 'int',
                value: signed ? -1n : 0n, // 0:false, -1:true
            } as TupleItemInt,
            {
                type: 'int',
                value,
            } as TupleItemInt,
        ]);
        return result.stack.readBuffer();
    }

    async getEncodeLength(provider: ContractProvider, value: bigint, signed: boolean = false) {
        const result = await provider.get('get_encode_length', [
            {
                type: 'int',
                value: signed ? -1n : 0n, // 0:false, -1:true
            } as TupleItemInt,
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
            {
                type: 'int',
                value: BigInt(txs.length),
            } as TupleItemInt,
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
                type: 'cell',
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
                type: 'cell',
                cell: cell.endCell(),
            },
        ]);
        return result.stack.readBuffer();
    }
}

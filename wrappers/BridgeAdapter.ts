import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { TxBodyWasm, txBodyWasmToRef } from './TestClient';
import { crc32 } from '../crc32';
import { buffer } from 'stream/consumers';

export type BridgeAdapterConfig = {
    bridge_wasm_smart_contract: string;
    light_client: Address;
};

export function jsonToSliceRef(value: Object): Cell {
    switch (typeof value) {
        case 'undefined':
        case 'function':
        case 'symbol':
            return beginCell().endCell();
        case 'string':
        case 'number':
        case 'boolean':
            return beginCell().storeBuffer(Buffer.from(value.toString())).endCell();
        case 'object':
            let cell = beginCell().endCell();
            const reverseEntries = Object.entries(value).reverse();
            for (const [key, value] of reverseEntries) {
                cell = beginCell()
                    .storeRef(cell)
                    .storeRef(beginCell().storeBuffer(Buffer.from(key)).endCell())
                    .storeRef(jsonToSliceRef(value))
                    .endCell();
            }
            return cell;
        default:
            throw new Error('Invalid JSON');
    }
}

export function sliceRefToJson(cell: Cell): Object {
    let innerCell = cell.beginParse();
    if (innerCell.remainingRefs !== 3) {
        return innerCell.loadStringTail();
    }
    let json: { [key: string]: Object } = {};

    while (innerCell.remainingRefs) {
        const nextProps = innerCell.loadRef();
        const key = innerCell.loadRef();
        const value = innerCell.loadRef();
        // return value;
        json[key.asSlice().loadStringTail()] = sliceRefToJson(value);
        innerCell = nextProps.beginParse();
    }

    return json;
}

export function bridgeAdapterConfigToCell(config: BridgeAdapterConfig): Cell {
    return beginCell()
        .storeAddress(config.light_client)
        .storeRef(beginCell().storeBuffer(Buffer.from(config.bridge_wasm_smart_contract)).endCell())
        .endCell();
}

export const Opcodes = {
    sendTx: crc32('op::send_tx'),
    confirmTx: crc32('op::confirm_tx'),
};

export class BridgeAdapter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new BridgeAdapter(address);
    }

    static createFromConfig(config: BridgeAdapterConfig, code: Cell, workchain = 0) {
        const data = bridgeAdapterConfigToCell(config);
        const init = { code, data };
        return new BridgeAdapter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTx(provider: ContractProvider, via: Sender, txWasm: TxBodyWasm, value: bigint) {
        const txBody = txBodyWasmToRef(txWasm);
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Opcodes.sendTx, 32).storeUint(0, 64).storeRef(txBody).endCell(),
        });
    }
}

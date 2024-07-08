import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
} from '@ton/core';
import { getAuthInfoInput, txBodyWasmToRef } from './utils';
import { TxWasm } from './@types';
import { crc32 } from '../crc32';
import { ValueOps } from './@types';
import { fromBech32 } from '@cosmjs/encoding';

export type BridgeAdapterConfig = {
    light_client_master: Address;
    whitelist_denom: Address;
    bridge_wasm_smart_contract: string;
    jetton_wallet_code: Cell;
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
        case 'object': {
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
        }
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
        .storeAddress(config.light_client_master)
        .storeAddress(config.whitelist_denom)
        .storeUint(1, 64) // next_packet_seq initial value = 1
        .storeRef(
            beginCell()
                .storeBuffer(Buffer.from(fromBech32(config.bridge_wasm_smart_contract).data))
                .endCell(),
        )
        .storeRef(config.jetton_wallet_code)
        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell()) // empty dict
        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell()) // empty dict
        .endCell();
}

export const BridgeAdapterOpcodes = {
    bridgeRecvPacket: crc32('op::bridge_recv_packet'),
    onRecvPacket: crc32('op::on_recv_packet'),
    callbackDenom: crc32('op::callback_denom'),
    bridgeTon: crc32('op::bridge_ton'),
};

export const BridgeAdapterPacketOpcodes = {
    sendToTon: crc32('op::send_to_ton'),
};

export const Src = {
    COSMOS: crc32('src::cosmos'),
    TON: crc32('src::ton'),
};

export interface BridgeRecvPacket {
    proofs: Cell;
    packet: Cell;
    provenHeight: number;
}

export interface BridgeTon {
    amount: bigint;
    timeout: bigint;
    memo: Cell;
}

export class BridgeAdapter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static buildBridgeRecvPacketBody(bridgeRecvPacketData: BridgeRecvPacket, queryId: number = 0) {
        return beginCell()
            .storeUint(BridgeAdapterOpcodes.bridgeRecvPacket, 32)
            .storeUint(queryId, 64)
            .storeRef(
                beginCell()
                    .storeUint(bridgeRecvPacketData.provenHeight, 64)
                    .storeRef(bridgeRecvPacketData.proofs)
                    .storeRef(bridgeRecvPacketData.packet)
                    .endCell(),
            )
            .endCell();
    }

    static createFromAddress(address: Address) {
        return new BridgeAdapter(address);
    }

    static createFromConfig(config: BridgeAdapterConfig, code: Cell, workchain = 0) {
        const data = bridgeAdapterConfigToCell(config);
        const init = { code, data };
        return new BridgeAdapter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell().endCell(),
        });
    }

    async sendBridgeTon(provider: ContractProvider, via: Sender, data: BridgeTon, ops: ValueOps) {
        const body = beginCell()
            .storeCoins(data.amount)
            .storeUint(data.timeout, 64)
            .storeRef(data.memo)
            .endCell();

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell()
                .storeUint(BridgeAdapterOpcodes.bridgeTon, 32)
                .storeUint(ops.queryId || 0, 64)
                .storeRef(body)
                .endCell(),
        });
    }

    async sendBridgeRecvPacket(
        provider: ContractProvider,
        via: Sender,
        data: BridgeRecvPacket,
        ops: ValueOps,
    ) {
        const sendTxBody = BridgeAdapter.buildBridgeRecvPacketBody(data, ops.queryId);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value: ops.value,
            body: sendTxBody,
        });
    }

    async getBridgeData(provider: ContractProvider) {
        const result = await provider.get('get_bridge_data', []);
        return result.stack;
    }
}

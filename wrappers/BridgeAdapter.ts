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
import { crc32 } from '../crc32';
import { ValueOps } from './@types';
import { fromBech32, toBech32 } from '@cosmjs/encoding';

export type BridgeAdapterConfig = {
    light_client_master: Address;
    admin: Address;
    whitelist_denom: Address;
    bridge_wasm_smart_contract: string;
    jetton_wallet_code: Cell;
    paused: 0 | 1;
};

export enum BridgeAdapterError {
    INVALID_PACKET_OPCODE = 3000,
    UNAUTHORIZED_SENDER = 3001,
    PROCESSED_PACKET = 3002,
    UNSUPPORTED_DENOM = 3003,
    PACKET_TIMEOUT = 3004,
    INVALID_NATIVE_AMOUNT = 3005,
    PACKET_VERIFIED_EXIST_FAIL = 3006,
    NOT_TIME_TO_REFUND_ACK_PACKET = 3007,
    PACKET_DOES_NOT_EXIST = 3008,
    PAUSED = 3009,
}

export function bridgeAdapterConfigToCell(config: BridgeAdapterConfig): Cell {
    return beginCell()
        .storeAddress(config.light_client_master)
        .storeAddress(config.admin)
        .storeAddress(config.whitelist_denom)
        .storeUint(1, 64) // next_packet_seq initial value = 1
        .storeUint(config.paused, 1)
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
    setPaused: 1,
    upgradeContract: 2,
    changeAdmin: 3,
};

export const BridgeAdapterPacketOpcodes = {
    sendToTon: crc32('op::send_to_ton'),
};

export const TokenOrigin = {
    COSMOS: crc32('token_origin::cosmos'),
    TON: crc32('token_origin::ton'),
};

export enum Paused {
    UNPAUSED = 0,
    PAUSED = 1,
}

export enum Ack {
    Success = 0,
    Error = 1,
    Timeout = 2,
}

export interface BridgeRecvPacket {
    proofs: Cell;
    packet: Cell;
    provenHeight: number;
    ack?: Ack;
}

export interface BridgeTon {
    amount: bigint;
    timeout: bigint;
    memo: Cell;
    remoteReceiver: string;
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
                bridgeRecvPacketData?.ack !== undefined
                    ? beginCell()
                          .storeUint(bridgeRecvPacketData.provenHeight, 64)
                          .storeUint(bridgeRecvPacketData.ack, 2)
                          .storeRef(bridgeRecvPacketData.proofs)
                          .storeRef(bridgeRecvPacketData.packet)
                          .endCell()
                    : beginCell()
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

    static parseBridgeDataResponse(cell: Cell) {
        const cs = cell.beginParse();
        const lightClientMasterAddress = cs.loadAddress();
        const adminAddress = cs.loadAddress();
        const whitelistDenomAddress = cs.loadAddress();
        const next_packet_seq = cs.loadUint(64);
        const paused = cs.loadUint(1);
        const bridgeWasmBech32 = toBech32(
            'orai',
            Buffer.from(cs.loadRef().beginParse().asCell().bits.toString(), 'hex'),
        );
        return {
            lightClientMasterAddress,
            adminAddress,
            whitelistDenomAddress,
            next_packet_seq,
            paused,
            bridgeWasmBech32,
        };
    }

    async sendDeploy(provider: ContractProvider, via: Sender, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell().endCell(),
        });
    }

    async sendBridgeTon(provider: ContractProvider, via: Sender, data: BridgeTon, ops: ValueOps) {
        const remoteCosmosData = fromBech32(data.remoteReceiver).data;
        const body = beginCell()
            .storeCoins(data.amount)
            .storeUint(data.timeout, 64)
            .storeUint(Buffer.from(remoteCosmosData).length, 8)
            .storeBuffer(Buffer.from(remoteCosmosData))
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

    async sendSetPaused(provider: ContractProvider, via: Sender, paused: 0 | 1, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell()
                .storeUint(BridgeAdapterOpcodes.setPaused, 32)
                .storeUint(ops.queryId ?? 0, 64)
                .storeUint(paused, 1)
                .endCell(),
        });
    }

    async sendUpgradeContract(
        provider: ContractProvider,
        via: Sender,
        new_code: Cell,
        ops: ValueOps,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell()
                .storeUint(BridgeAdapterOpcodes.upgradeContract, 32)
                .storeUint(ops.queryId ?? 0, 64)
                .storeRef(new_code)
                .endCell(),
        });
    }

    async sendChangeAdmin(provider: ContractProvider, via: Sender, admin: Address, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell()
                .storeUint(BridgeAdapterOpcodes.changeAdmin, 32)
                .storeUint(ops.queryId ?? 0, 64)
                .storeAddress(admin)
                .endCell(),
        });
    }

    async getBridgeData(provider: ContractProvider) {
        const result = await provider.get('get_bridge_data', []);
        return result.stack;
    }

    async getSendPacketCommitment(provider: ContractProvider, seq: bigint) {
        const result = await provider.get('get_send_packet_commitment', [
            {
                type: 'int',
                value: seq,
            },
        ]);
        return result.stack.readCell();
    }
}

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
import { ValueOps } from './@types';

export enum JettonOpCodes {
    TRANSFER = 0xf8a7ea5,
    TRANSFER_NOTIFICATION = 0x7362d09c,
    INTERNAL_TRANSFER = 0x178d4519,
    EXCESSES = 0xd53276db,
    BURN = 0x595f07bc,
    BURN_NOTIFICATION = 0x7bdd97de,
    MINT = 21,
}

export type UsdtJettonWalletConfig = {
    ownerAddress: Address;
    minterAddress: Address;
    walletCode: Cell;
};

export function jettonWalletConfigToCell(config: UsdtJettonWalletConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.ownerAddress)
        .storeAddress(config.minterAddress)
        .storeRef(config.walletCode)
        .endCell();
}

export interface SendTransferInterface {
    toAddress: Address;
    fwdAmount: bigint;
    jettonAmount: bigint;
    jettonMaster: Address;
    memo: Cell;
}

export class UsdtJettonWallet implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new UsdtJettonWallet(address);
    }

    static createFromConfig(config: UsdtJettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config);
        const init = { code, data };
        return new UsdtJettonWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTransfer(provider: ContractProvider, via: Sender, data: SendTransferInterface, opts: ValueOps) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonOpCodes.TRANSFER, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeCoins(data.jettonAmount)
                .storeAddress(data.toAddress)
                .storeAddress(via.address) // response address
                .storeDict(Dictionary.empty())
                .storeCoins(data.fwdAmount)
                .storeUint(0, 1)
                .storeRef(beginCell().storeAddress(data.jettonMaster).endCell())
                .storeRef(data.memo)
                .endCell(),
        });
    }

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            queryId: number;
            jettonAmount: bigint;
            eth_addr: bigint;
            adapter_addr: Address;
        },
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonOpCodes.BURN, 32)
                .storeUint(opts.queryId, 64)
                .storeCoins(opts.jettonAmount)
                .storeAddress(via.address)
                .storeAddress(opts.adapter_addr)
                .storeUint(opts.eth_addr, 256)
                .storeUint(0, 1)
                .endCell(),
        });
    }

    async getBalance(provider: ContractProvider) {
        const state = await provider.getState();
        if (state.state.type !== 'active') {
            return { amount: 0n };
        }
        const { stack } = await provider.get('get_wallet_data', []);
        const [amount] = [stack.readBigNumber()];
        return { amount };
    }
}

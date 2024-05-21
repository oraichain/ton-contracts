import { Address, Cell, Contract, ContractProvider, SendMode, Sender, beginCell, contractAddress } from '@ton/core';

const MAX_BYTES_CELL = 1023 / 8 - 1;

export type DemoConfig = {
    amount: number;
    receiver: string;
    tokenDenom: string;
};

export function demoConfigToCell(config: DemoConfig): Cell {
    return beginCell()
        .storeUint(config.amount, 32)
        .storeRef(beginCell().storeBuffer(Buffer.from(config.receiver)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(config.tokenDenom)).endCell())
        .endCell();
}

export class Demo implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Demo(address);
    }

    static createFromConfig(config: DemoConfig, code: Cell, workchain = 0) {
        const data = demoConfigToCell(config);
        const init = { code, data };
        return new Demo(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendUpdateDemoData(
        provider: ContractProvider,
        via: Sender,
        opts: {
            sent_funds: string;
            amount: number;
            receiver: string;
            tokenDenom: string;
        },
    ) {
        await provider.internal(via, {
            value: opts.sent_funds,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(opts.amount ?? 0, 32)
                .storeBuffer(Buffer.from(opts.receiver))
                .storeBuffer(Buffer.from(opts.tokenDenom))
                .endCell(),
        });
    }

    async getAmount(provider: ContractProvider) {
        const result = await provider.get('getAmount', []);
        return result.stack.readNumber();
    }

    async getReceiver(provider: ContractProvider) {
        const result = await provider.get('getReceiver', []);
        return result.stack.readBuffer().toString('utf-8');
    }

    async getTokenDenom(provider: ContractProvider) {
        const result = await provider.get('getTokenDenom', []);
        return result.stack.readBuffer().toString('utf-8');
    }
}

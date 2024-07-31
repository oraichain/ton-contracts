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
    toNano,
} from '@ton/core';

export class LightClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LightClient(address);
    }

    async getHeight(provider: ContractProvider) {
        const result = await provider.get('get_height', []);
        return result.stack.readNumber();
    }

    async getTrustingPeriod(provider: ContractProvider) {
        const result = await provider.get('get_trusting_period', []);
        return result.stack.readNumber();
    }

    async getCreatedAt(provider: ContractProvider) {
        const result = await provider.get('get_created_at', []);
        return result.stack.readNumber();
    }

    async getChainId(provider: ContractProvider) {
        const result = await provider.get('get_chain_id', []);
        return result.stack.readBuffer().toString('utf-8');
    }

    async getAppHash(provider: ContractProvider) {
        const result = await provider.get('get_app_hash', []);
        return result.stack.readBuffer();
    }

    async getValidatorHash(provider: ContractProvider) {
        const result = await provider.get('get_validator_hash_set', []);
        return result.stack.readBuffer();
    }
}

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import * as coinFixtures from '../fixtures/coin.json';

describe('Coin', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let coin: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        coin = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await coin.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: coin.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const data of Object.values(coinFixtures)) {
            if (data?.denom !== undefined && data?.amount !== undefined) {
                const encodeCoin = await coin.getCoinEncode(data.denom, data.amount);
                expect(encodeCoin.toString('hex')).toBe(
                    Buffer.from(
                        Coin.encode({
                            denom: data.denom,
                            amount: data.amount,
                        }).finish(),
                    ).toString('hex'),
                );
            }
        }
    });
});

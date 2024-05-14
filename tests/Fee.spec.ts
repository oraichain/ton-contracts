import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Fee } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { int64FromString, int64ToString } from 'cosmjs-types/varint';

describe('Fee', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let fee: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        fee = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await fee.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: fee.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        expect(
            (
                await fee.get__Fee__encode({
                    amount: [
                        {
                            amount: '290340233334',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 9238498234n,
                    granter: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                    payer: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
                })
            ).toString('hex'),
        ).toBe(
            Buffer.from(
                Fee.encode({
                    amount: [
                        {
                            amount: '290340233334',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 9238498234n,
                    granter: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                    payer: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
                }).finish(),
            ).toString('hex'),
        );

        expect(
            (
                await fee.get__Fee__encode({
                    amount: [
                        {
                            amount: '290340233334',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 100000n,
                    granter: '',
                    payer: '',
                })
            ).toString('hex'),
        ).toBe(
            Buffer.from(
                Fee.encode({
                    amount: [
                        {
                            amount: '290340233334',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 100000n,
                    granter: '',
                    payer: '',
                }).finish(),
            ).toString('hex'),
        );

        expect(
            (
                await fee.get__Fee__encode({
                    amount: [
                        {
                            amount: '9834985',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 0n,
                    granter: '',
                    payer: '',
                })
            ).toString('hex'),
        ).toBe(
            Buffer.from(
                Fee.encode({
                    amount: [
                        {
                            amount: '9834985',
                            denom: 'orai',
                        },
                    ],
                    gasLimit: 0n,
                    granter: '',
                    payer: '',
                }).finish(),
            ).toString('hex'),
        );
    });
});

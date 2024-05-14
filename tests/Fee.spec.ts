import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Fee } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import fixtures from './fixtures/fee.json';

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

    it('test encode length', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect(await fee.get__Fee__encodeLength(fixture as any)).toBe(Fee.encode(fixture as any).len);
            }
        }
        console.log(
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
            }).len,
        );
        // expect(
        //     await fee.get__Fee__encodeLength({
        //         amount: [
        //             {
        //                 amount: '290340233334',
        //                 denom: 'orai',
        //             },
        //         ],
        //         gasLimit: 9238498234n,
        //         granter: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
        //         payer: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
        //     }),
        // ).toBe(
        //     Fee.encode({
        //         amount: [
        //             {
        //                 amount: '290340233334',
        //                 denom: 'orai',
        //             },
        //         ],
        //         gasLimit: 9238498234n,
        //         granter: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
        //         payer: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
        //     }).len,
        // );
    });

    it('test encode', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect((await fee.get__Fee__encode(fixture as any)).toString('hex')).toBe(
                    Buffer.from(Fee.encode(fixture as any).finish()).toString('hex'),
                );
            }
        }
    });
});

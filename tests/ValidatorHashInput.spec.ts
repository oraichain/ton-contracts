import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fixtures from './fixtures/validator_hash_input.json';

describe('Validator Hash Input', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let vhi: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        vhi = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await vhi.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: vhi.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(fixtures)) {
            if (fixture?.value !== undefined && fixture?.encoding !== undefined) {
                console.log(btoa(String.fromCharCode.apply(null, fixture.value.pub_key)));
                expect(
                    (
                        await vhi.getValidatorHashInputEncode(
                            'NNJledu0Vmk+VAZyz5IvUt3g1lMuNb8GvgE6fFMvIOA=',
                            fixture.value.voting_power,
                        )
                    ).toString('hex'),
                ).toBe(fixture.encoding);
            }
        }
    });
});

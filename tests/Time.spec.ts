import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { getTimeComponent, LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as timeFixtures from './fixtures/time.json';

describe('Version', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let time: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        time = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await time.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: time.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode length', async () => {
        let expectedLength = 0;
        console.log('Time:', timeFixtures[0].value);
        const { seconds, nanoseconds } = getTimeComponent(timeFixtures[0].value);
        const secondsLength = await time.getEncodeLength(BigInt(seconds));
        const nanosLength = await time.getEncodeLength(BigInt(nanoseconds));
        expectedLength += 2 + secondsLength + nanosLength;
        expect(time.getTimeEncodeLength(timeFixtures[0].value)).resolves.toBe(expectedLength);
    });

    it('test encode', async () => {
        console.log(Object.values(timeFixtures));
        for (const timeFixture of Object.values(timeFixtures)) {
            if (timeFixture?.value !== undefined && timeFixture.encoding !== undefined) {
                console.log('Time:', timeFixture.value);
                const rawTimeEncode = await time.getTimeEncode(timeFixture.value);
                console.log(getTimeComponent(timeFixture.value));
                expect(rawTimeEncode.toString('hex')).toBe(timeFixture.encoding);
            }
        }
    });
});

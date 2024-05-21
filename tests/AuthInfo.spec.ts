import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { AuthInfo, SignerInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx';

describe('Auth Info', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let authInfo: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        authInfo = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await authInfo.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: authInfo.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode & encode length', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
                'base64',
            ),
        );
        const data = decodedTx.authInfo;
        const tuple = await authInfo.getAuthInfoEncode(data);
        let buffer = Buffer.alloc(0);
        while (tuple.remaining > 0) {
            const item = tuple.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }
        expect(buffer.toString('hex')).toEqual(Buffer.from(AuthInfo.encode(data).finish()).toString('hex'));
        expect(await authInfo.getAuthInfoEncodeLength(data)).toBe(AuthInfo.encode(data).len);
    });
});

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { Tx } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

BigInt.prototype.toJSON = function () {
    return this.toString();
};

describe('TxEncoded', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let TxEncoded: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        TxEncoded = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await TxEncoded.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: TxEncoded.address,
            deploy: true,
            success: true,
        });
    });

    xit('test TxEncoded encode', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CsAICr0ICiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSlAgKK29yYWkxemZreHlycjdzY3NlOGMzdHl0OTlkbWg5NmM3bXA5ZGo3ZTMzY2oSK29yYWkxNWh1YTJxODNmcDY2Nm53aG55cm45ZzhndDl1ZWVubDMycW51Z2gatwd7ImRpc3RyaWJ1dGUiOnsic3Rha2luZ190b2tlbnMiOlsib3JhaTFoeG00MzNobnd0aHJ4bmV5anlzdmhueTUzOXM5a2g2czJnMm44eSIsIm9yYWkxcW15M3V1eGt0Zmx2cmVhbmFxcGg2eXVhN3N0am42ajY1cnVyNjIiLCJvcmFpMWcycHJxcnkzNDNreDU2NmNwN3V3czl3N3Y3OG41dGVqeWx2YXo2Iiwib3JhaTFtYXY1MmVxaGQwN2MzbHdldmNucWR5a2R6aGg0NzMzemYzMmpjbiIsIm9yYWkxN3JjZmNyd2x0dWpmdng3dzRsMmdneWt1OHFybmN5MGhkdnJ6dmMiLCJvcmFpMTlsdGo5N2ptZHFuejVtcmQyYW1ldGhldHZjd3NwMDIyMGt3dzNlIiwib3JhaTE4eXdsbHcwM2h2eTcyMGwwNnJtZTBhcHd5eXE5cGxrNjRoOWNjZiIsIm9yYWkxYXk2ODlsdHI1N2p0MnNudWphcnZha3hybXR1cThmaHVhdDVybnZxNnJjdDg5dmplcjlncW0ydmRlNiIsIm9yYWkxZTB4ODd3OWV6d3Eyc2RtdnY1ZHE1bmd6eTk4bHQ0N3RxZmFmMm03enBrZzQ5ZzVkajZmcXJlZDVkNyIsIm9yYWkxd2d5d2d2dW10NWR4aG03dmpwd3g1ZXM5ZWNydGw4NXFhcWRzcGpxd3gybHVneTd2bXc1cWx3cm44OCIsIm9yYWkxaGNqbmUwaG1kajZwanJjM3h1a3N1Y3IweXBsc2E5bnk3djA0N2MzNHk4azhoZmZscTZ5cXlqYXBubiIsIm9yYWkxc2xxdzZnZnZzNmwyamd2aDVyeWpheWY0Zzc3ZDdzZ2Z2NmZ1bXR5emNyMDZhNmc5Z25ycTZjNHJnZyIsIm9yYWkxbndwZmQwOW1yNHJmOGQ1YzltaDQzYXh6ZXprd3lyN2RxMmx1czIzanN3NHh3Mmpxa2F4cXh3bWtkMyIsIm9yYWkxcnZyOXdrNm1kbGZ5c3ZncDcybHR0aHF2a2tkNTY3N21wODkyZWZxODZ5eXI5YWx0MHRtczJhNmxjcyIsIm9yYWkxamQ5bGMycXQwbHRqc2F0Z251Mzh4c3o4bmdwODljbHAwZHBlaDhnZXlqajcweXZrbjRrcW1ybWgzbSIsIm9yYWkxeHM1YWo5MGQ1bThrd2ZwOXQ2Z2hrY3BrOGQ3c3k1anN4ZHN5ZWpqZHh1ZGhoZm03d2Vnc2RnOTI5ZCJdfX0SaApSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAqW27ULzxYqN3Mb1+u5ElHEmeGpViohTpGXC4tDusEpnEgQKAggBGOrjEBISCgwKBG9yYWkSBDE1NTAQsM1eGkDFNBeNBwb246XJAXVjCSfEIs09CRwiqgHYpBcOgMCCpXbFAA9DCy4mJbz7/Z0izRmokIluSZgEjOhMIYkZW0tq',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });

        const decodedTxWithRawMsg: any = {
            ...decodedTx,
            body: {
                messages: rawMsg,
                memo: decodedTx.body.memo,
                timeoutHeight: decodedTx.body.timeoutHeight,
                extensionOptions: decodedTx.body.extensionOptions,
                nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
            },
        };

        console.log({ decodedTxWithRawMsg });
        const tuple = await TxEncoded.getDecodedTxRaw(decodedTxWithRawMsg);

        let buffer = Buffer.alloc(0);

        while (tuple.remaining > 0) {
            const item = tuple.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(
            Buffer.from(
                Tx.encode({
                    signatures: decodedTx.signatures as any,
                    authInfo: decodedTx.authInfo,
                    body: decodedTx.body,
                }).finish(),
            ).toString('hex'),
        );
    });

    it('test TxEncoded encode 1', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });

        const decodedTxWithRawMsg: any = {
            ...decodedTx,
            body: {
                messages: rawMsg,
                memo: decodedTx.body.memo,
                timeoutHeight: decodedTx.body.timeoutHeight,
                extensionOptions: decodedTx.body.extensionOptions,
                nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
            },
        };

        console.log({ decodedTxWithRawMsg });
        const tuple = await TxEncoded.getDecodedTxRaw(decodedTxWithRawMsg);

        let buffer = Buffer.alloc(0);

        while (tuple.remaining > 0) {
            const item = tuple.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(
            Buffer.from(
                Tx.encode({
                    signatures: decodedTx.signatures as any,
                    authInfo: decodedTx.authInfo,
                    body: decodedTx.body,
                }).finish(),
            ).toString('hex'),
        );
    });
});

import { sha256 } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';
import { Registry, decodeTxRaw } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { compile } from '@ton/blueprint';
import { Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { TestClient } from '../wrappers/TestClient';

describe('TxHash', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let TxHash: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        TxHash = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await TxHash.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: TxHash.address,
            deploy: true,
            success: true,
        });
    });

    it('test TxHash encode', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CsAICr0ICiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSlAgKK29yYWkxemZreHlycjdzY3NlOGMzdHl0OTlkbWg5NmM3bXA5ZGo3ZTMzY2oSK29yYWkxNWh1YTJxODNmcDY2Nm53aG55cm45ZzhndDl1ZWVubDMycW51Z2gatwd7ImRpc3RyaWJ1dGUiOnsic3Rha2luZ190b2tlbnMiOlsib3JhaTFoeG00MzNobnd0aHJ4bmV5anlzdmhueTUzOXM5a2g2czJnMm44eSIsIm9yYWkxcW15M3V1eGt0Zmx2cmVhbmFxcGg2eXVhN3N0am42ajY1cnVyNjIiLCJvcmFpMWcycHJxcnkzNDNreDU2NmNwN3V3czl3N3Y3OG41dGVqeWx2YXo2Iiwib3JhaTFtYXY1MmVxaGQwN2MzbHdldmNucWR5a2R6aGg0NzMzemYzMmpjbiIsIm9yYWkxN3JjZmNyd2x0dWpmdng3dzRsMmdneWt1OHFybmN5MGhkdnJ6dmMiLCJvcmFpMTlsdGo5N2ptZHFuejVtcmQyYW1ldGhldHZjd3NwMDIyMGt3dzNlIiwib3JhaTE4eXdsbHcwM2h2eTcyMGwwNnJtZTBhcHd5eXE5cGxrNjRoOWNjZiIsIm9yYWkxYXk2ODlsdHI1N2p0MnNudWphcnZha3hybXR1cThmaHVhdDVybnZxNnJjdDg5dmplcjlncW0ydmRlNiIsIm9yYWkxZTB4ODd3OWV6d3Eyc2RtdnY1ZHE1bmd6eTk4bHQ0N3RxZmFmMm03enBrZzQ5ZzVkajZmcXJlZDVkNyIsIm9yYWkxd2d5d2d2dW10NWR4aG03dmpwd3g1ZXM5ZWNydGw4NXFhcWRzcGpxd3gybHVneTd2bXc1cWx3cm44OCIsIm9yYWkxaGNqbmUwaG1kajZwanJjM3h1a3N1Y3IweXBsc2E5bnk3djA0N2MzNHk4azhoZmZscTZ5cXlqYXBubiIsIm9yYWkxc2xxdzZnZnZzNmwyamd2aDVyeWpheWY0Zzc3ZDdzZ2Z2NmZ1bXR5emNyMDZhNmc5Z25ycTZjNHJnZyIsIm9yYWkxbndwZmQwOW1yNHJmOGQ1YzltaDQzYXh6ZXprd3lyN2RxMmx1czIzanN3NHh3Mmpxa2F4cXh3bWtkMyIsIm9yYWkxcnZyOXdrNm1kbGZ5c3ZncDcybHR0aHF2a2tkNTY3N21wODkyZWZxODZ5eXI5YWx0MHRtczJhNmxjcyIsIm9yYWkxamQ5bGMycXQwbHRqc2F0Z251Mzh4c3o4bmdwODljbHAwZHBlaDhnZXlqajcweXZrbjRrcW1ybWgzbSIsIm9yYWkxeHM1YWo5MGQ1bThrd2ZwOXQ2Z2hrY3BrOGQ3c3k1anN4ZHN5ZWpqZHh1ZGhoZm03d2Vnc2RnOTI5ZCJdfX0SaApSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAqW27ULzxYqN3Mb1+u5ElHEmeGpViohTpGXC4tDusEpnEgQKAggBGOrjEBISCgwKBG9yYWkSBDE1NTAQsM1eGkDFNBeNBwb246XJAXVjCSfEIs09CRwiqgHYpBcOgMCCpXbFAA9DCy4mJbz7/Z0izRmokIluSZgEjOhMIYkZW0tq',
                'base64',
            ),
        );
        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const hex = Buffer.from(
            'CsAICr0ICiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSlAgKK29yYWkxemZreHlycjdzY3NlOGMzdHl0OTlkbWg5NmM3bXA5ZGo3ZTMzY2oSK29yYWkxNWh1YTJxODNmcDY2Nm53aG55cm45ZzhndDl1ZWVubDMycW51Z2gatwd7ImRpc3RyaWJ1dGUiOnsic3Rha2luZ190b2tlbnMiOlsib3JhaTFoeG00MzNobnd0aHJ4bmV5anlzdmhueTUzOXM5a2g2czJnMm44eSIsIm9yYWkxcW15M3V1eGt0Zmx2cmVhbmFxcGg2eXVhN3N0am42ajY1cnVyNjIiLCJvcmFpMWcycHJxcnkzNDNreDU2NmNwN3V3czl3N3Y3OG41dGVqeWx2YXo2Iiwib3JhaTFtYXY1MmVxaGQwN2MzbHdldmNucWR5a2R6aGg0NzMzemYzMmpjbiIsIm9yYWkxN3JjZmNyd2x0dWpmdng3dzRsMmdneWt1OHFybmN5MGhkdnJ6dmMiLCJvcmFpMTlsdGo5N2ptZHFuejVtcmQyYW1ldGhldHZjd3NwMDIyMGt3dzNlIiwib3JhaTE4eXdsbHcwM2h2eTcyMGwwNnJtZTBhcHd5eXE5cGxrNjRoOWNjZiIsIm9yYWkxYXk2ODlsdHI1N2p0MnNudWphcnZha3hybXR1cThmaHVhdDVybnZxNnJjdDg5dmplcjlncW0ydmRlNiIsIm9yYWkxZTB4ODd3OWV6d3Eyc2RtdnY1ZHE1bmd6eTk4bHQ0N3RxZmFmMm03enBrZzQ5ZzVkajZmcXJlZDVkNyIsIm9yYWkxd2d5d2d2dW10NWR4aG03dmpwd3g1ZXM5ZWNydGw4NXFhcWRzcGpxd3gybHVneTd2bXc1cWx3cm44OCIsIm9yYWkxaGNqbmUwaG1kajZwanJjM3h1a3N1Y3IweXBsc2E5bnk3djA0N2MzNHk4azhoZmZscTZ5cXlqYXBubiIsIm9yYWkxc2xxdzZnZnZzNmwyamd2aDVyeWpheWY0Zzc3ZDdzZ2Z2NmZ1bXR5emNyMDZhNmc5Z25ycTZjNHJnZyIsIm9yYWkxbndwZmQwOW1yNHJmOGQ1YzltaDQzYXh6ZXprd3lyN2RxMmx1czIzanN3NHh3Mmpxa2F4cXh3bWtkMyIsIm9yYWkxcnZyOXdrNm1kbGZ5c3ZncDcybHR0aHF2a2tkNTY3N21wODkyZWZxODZ5eXI5YWx0MHRtczJhNmxjcyIsIm9yYWkxamQ5bGMycXQwbHRqc2F0Z251Mzh4c3o4bmdwODljbHAwZHBlaDhnZXlqajcweXZrbjRrcW1ybWgzbSIsIm9yYWkxeHM1YWo5MGQ1bThrd2ZwOXQ2Z2hrY3BrOGQ3c3k1anN4ZHN5ZWpqZHh1ZGhoZm03d2Vnc2RnOTI5ZCJdfX0SaApSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAqW27ULzxYqN3Mb1+u5ElHEmeGpViohTpGXC4tDusEpnEgQKAggBGOrjEBISCgwKBG9yYWkSBDE1NTAQsM1eGkDFNBeNBwb246XJAXVjCSfEIs09CRwiqgHYpBcOgMCCpXbFAA9DCy4mJbz7/Z0izRmokIluSZgEjOhMIYkZW0tq',
            'base64',
        ).toString('hex');

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
        console.log(decodedTxWithRawMsg.body);
        console.log(decodedTxWithRawMsg.authInfo);
        console.log(decodedTxWithRawMsg.signatures);

        const hash = await TxHash.getTxHash(decodedTxWithRawMsg);

        console.log(hash.toString(16));

        expect(hash.toString(16)).toEqual(toHex(sha256(Buffer.from(hex, 'hex'))));
    });
});

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';


describe('CanonicalVote', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let CanonicalVote: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        CanonicalVote = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await CanonicalVote.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: CanonicalVote.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
     console.log(await CanonicalVote.get__CanonicalVote__encode(
         {
          "type": 0,
          "height": 1,
          "round": 2,
          "block_id": {
            "hash": "",
            "parts": {
              "total": 0,
              "hash": ""
            }
          },
          "timestamp": "1973-11-29T21:33:09.123456789Z",
          chain_id: "Oraichain"
        }
      ))
    });
});

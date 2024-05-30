import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import blockData from './fixtures/data.json';
import { JettonMaster } from '@ton/ton';
import { BridgeAdapter } from '../wrappers/BridgeAdapter';

describe('BridgeAdapter', () => {
    let lightClientCode: Cell;
    let jettonWalletCode: Cell;
    let bridgeAdapterCode: Cell;
    beforeAll(async () => {
        lightClientCode = await compile('LightClient');
        jettonWalletCode = await compile('JettonWallet');
        bridgeAdapterCode = await compile('BridgeAdapter');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClient: SandboxContract<LightClient>;
    let bridgeAdapter: SandboxContract<BridgeAdapter>;


    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            vmLogs: 'vm_logs_gas',
        };
        lightClient = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    chainId: 'Oraichain',
                    height: 1,
                    validatorHashSet: '',
                    dataHash: '',
                    nextValidatorHashSet: '',
                },
                lightClientCode,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployLightClientResult = await lightClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployLightClientResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClient.address,
            deploy: true,
            success: true,
        });
        // BRIDGE_WASM_CONTRACT_HARD_CODING_ORAIX_CONTRACT
        // TODO: CHANGE TO BRIDGE WASM CONTRACT
        bridgeAdapter = blockchain.openContract(BridgeAdapter.createFromConfig({
            light_client: lightClient.address,
            bridge_wasm_smart_contract: 'orai1lus0f0rhx8s03gdllx2n6vhkmf0536dv57wfge',
            jetton_wallet_code: jettonWalletCode,
        }, bridgeAdapterCode))
     
        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), toNano('0.05'));
        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true
        });
    });

    it("successfully deploy BridgeAdapter contract", async () => {
        console.log("successfully deploy");
        const tuple = await bridgeAdapter.getBridgeData();
        console.log(tuple);
    })
    
});

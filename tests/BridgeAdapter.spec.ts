import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { LightClient,Opcodes} from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import blockData from './fixtures/bridgeData.json';
import { BridgeAdapter, Src,  } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';
import { createHash } from 'crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { getMerkleProofs } from '../wrappers/TestClient';
import { JettonWallet } from '../wrappers/JettonWallet';

describe('BridgeAdapter', () => {
    let lightClientCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;

    const bridgeWasmAddress = 'orai1lus0f0rhx8s03gdllx2n6vhkmf0536dv57wfge';
    const updateBlock = async (blockData: any, relayer: SandboxContract<TreasuryContract>) => {
        const { header, commit, validators, txs } = blockData;
   
        let result = await lightClient.sendVerifyBlockHash(
            relayer.getSender(),
            {
                appHash: header.app_hash,
                chainId: header.chain_id,
                consensusHash: header.consensus_hash,
                dataHash: header.data_hash,
                evidenceHash: header.evidence_hash,
                height: BigInt(header.height),
                lastBlockId: header.last_block_id,
                lastCommitHash: header.last_commit_hash,
                lastResultsHash: header.last_results_hash,
                validatorHash: header.validators_hash,
                nextValidatorHash: header.next_validators_hash,
                proposerAddress: header.proposer_address,
                time: header.time,
                version: header.version,
            },
            validators,
            { value: toNano('0.5') },
        );
        console.log(`blockhash:`, Opcodes.verify_block_hash);

        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });

        result = await lightClient.sendVerifyUntrustedValidators(relayer.getSender(), {
            value: toNano('1'),
        });
        console.log(Opcodes.verify_untrusted_validators);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_untrusted_validators,
        });

        result = await lightClient.sendVerifySigs(relayer.getSender(), commit, {
            value: toNano('1'),
        });

        console.log('verify_sigs', Opcodes.verify_sigs);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_sigs,
        });

        console.log('Finished: ', {
            height: await lightClient.getHeight(),
            chainId: await lightClient.getChainId(),
            dataHash: (await lightClient.getDataHash()).toString('hex'),
            validatorHash: (await lightClient.getValidatorHash()).toString('hex'),
        });
    };
    beforeAll(async () => {
        lightClientCode = await compile('LightClient');
        bridgeAdapterCode = await compile('BridgeAdapter');

        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');

    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClient: SandboxContract<LightClient>;
    let bridgeAdapter: SandboxContract<BridgeAdapter>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
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
            bridge_wasm_smart_contract: bridgeWasmAddress,
            jetton_wallet_code: jettonWalletCode,
        }, bridgeAdapterCode))
     
        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), toNano('0.05'));
        
        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true
        });

        jettonMinter =  blockchain.openContract(JettonMinter.createFromConfig(
            {
                adminAddress: bridgeAdapter.address,
                content: bridgeAdapterCode,
                jettonWalletCode: jettonWalletCode,
            },
            jettonMinterCode
        ));
        
        const deployJettonMinterResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployJettonMinterResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true
        })

        await deployer.getSender().send({
            to: bridgeAdapter.address,
            value: toNano('1000'),
        })

        await deployer.getSender().send({
            to: jettonMinter.address,
            value: toNano('1000'),
        })
    });

    it("successfully deploy BridgeAdapter contract", async () => {
        console.log("successfully deploy");
        const stack = await bridgeAdapter.getBridgeData();
        expect(stack.readCell().toBoc()).toEqual(beginCell().storeAddress(lightClient.address).endCell().toBoc());
        expect(stack.readCell().toBoc()).toEqual(beginCell().storeBuffer(Buffer.from(bridgeWasmAddress)).endCell().toBoc());;
        expect(stack.readCell().toBoc()).toEqual(jettonWalletCode.toBoc());
    })

    it("should persistent when creating memo to test", async()=>{
        const memo = beginCell()
        .storeAddress(Address.parse("EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT"))
        .storeAddress(jettonMinter.address)
        .storeUint(toNano(10), 128)
        .storeUint(Src.COSMOS, 32)
        .endCell().bits.toString();
        console.log({memo: Buffer.from(memo, 'hex').toString('hex').toUpperCase()});
    })

    it("successfully mint token to the user", async() => {
        const relayer = await blockchain.treasury('relayer');
        await updateBlock(blockData, relayer);
        const {header, txs} = blockData;
        const height = header.height;
        const chosenIndex = 0; // hardcode the txs with custom memo
        const leaves = txs.map((tx: string) => createHash('sha256').update(Buffer.from(tx, 'base64')).digest());
        const decodedTx = decodeTxRaw(Buffer.from(txs[chosenIndex], 'base64'));
      
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

        const userJettonWallet = await jettonMinter.getWalletAddress(Address.parse("EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT"));
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        console.log(BigInt("0x" + beginCell().storeAddress(wallet.address).endCell().hash().toString('hex')));

        const {branch: proofs, positions} = getMerkleProofs(leaves, leaves[chosenIndex]);

        const result = await bridgeAdapter.sendTx(
            relayer.getSender(), 
            BigInt(height), 
            decodedTxWithRawMsg, 
            proofs,
            positions,
            toNano('6')
        );

        expect(result.transactions).toHaveTransaction({
            op: Opcodes.verify_receipt,
            success:true
        })

        expect((await wallet.getBalance()).amount).toBe(toNano(10));
    })
    
});

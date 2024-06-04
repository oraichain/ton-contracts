import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import blockData from './fixtures/bridgeSrcCosmosData.json';
import blockSrcTONJettonData from './fixtures/bridgeSrcTonData.json';
import bridgeSrcNativeTonData from './fixtures/bridgeSrcNativeTonData.json';

import { BridgeAdapter, Src } from '../wrappers/BridgeAdapter';
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

    const bridgeWasmAddress = 'orai1qmu0l3864e6rspdew0dyf34k0ujndam8u0t5w7295pzlerhq827s60sx8e';
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
            { value: toNano('0.5') },
        );
        console.log(`blockhash:`, Opcodes.verify_block_hash);

        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });

        result = await lightClient.sendStoreUntrustedValidators(relayer.getSender(), validators, {
            value: toNano('0.5'),
        });
        console.log(Opcodes.store_untrusted_validators);

        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.store_untrusted_validators,
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
    let jettonMinterSrcCosmos: SandboxContract<JettonMinter>;
    let jettonMinterSrcTon: SandboxContract<JettonMinter>;
    let bridgeJettonWalletSrcTon: SandboxContract<JettonWallet>;

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
        console.log(deployer.address); //EQBGhqLAZseEqRXz4ByFPTGV7SVMlI4hrbs-Sps_Xzx01x8G
        const deployLightClientResult = await lightClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployLightClientResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClient.address,
            deploy: true,
            success: true,
        });
        // BRIDGE_WASM_CONTRACT_HARD_CODING_ORAIX_CONTRACT
        // TODO: CHANGE TO BRIDGE WASM CONTRACT
        bridgeAdapter = blockchain.openContract(
            BridgeAdapter.createFromConfig(
                {
                    light_client: lightClient.address,
                    bridge_wasm_smart_contract: bridgeWasmAddress,
                    jetton_wallet_code: jettonWalletCode,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true,
        });

        jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: bridgeAdapter.address,
                    content: bridgeAdapterCode,
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );

        const deployJettonMinterResult = await jettonMinterSrcCosmos.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployJettonMinterResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinterSrcCosmos.address,
            deploy: true,
            success: true,
        });

        jettonMinterSrcTon = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().endCell(),
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );

        const deployJettonMinterSrcTon = await jettonMinterSrcTon.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployJettonMinterSrcTon.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinterSrcTon.address,
            deploy: true,
            success: true,
        });

        await jettonMinterSrcTon.sendMint(deployer.getSender(), {
            toAddress: bridgeAdapter.address,
            jettonAmount: toNano(1000000000),
            amount: toNano(0.5), // deploy fee
            queryId: 0,
            value: toNano(1),
        });

        const bridgeJettonWallet = await jettonMinterSrcTon.getWalletAddress(bridgeAdapter.address);
        const bridgeJettonWalletBalance = JettonWallet.createFromAddress(bridgeJettonWallet);
        bridgeJettonWalletSrcTon = blockchain.openContract(bridgeJettonWalletBalance);

        expect((await bridgeJettonWalletSrcTon.getBalance()).amount).toBe(toNano(1000000000));

        await deployer.getSender().send({
            to: bridgeAdapter.address,
            value: toNano('1000'),
        });

        await deployer.getSender().send({
            to: jettonMinterSrcCosmos.address,
            value: toNano('1000'),
        });

        await deployer.getSender().send({
            to: jettonMinterSrcTon.address,
            value: toNano('1000'),
        });
        await deployer.getSender().send({
            to: bridgeJettonWalletSrcTon.address,
            value: toNano('1000'),
        });
    });

    it('successfully deploy BridgeAdapter contract', async () => {
        console.log('successfully deploy');
        const stack = await bridgeAdapter.getBridgeData();
        expect(stack.readCell().toBoc()).toEqual(beginCell().storeAddress(lightClient.address).endCell().toBoc());
        expect(stack.readCell().toBoc()).toEqual(
            beginCell().storeBuffer(Buffer.from(bridgeWasmAddress)).endCell().toBoc(),
        );
        expect(stack.readCell().toBoc()).toEqual(jettonWalletCode.toBoc());
    });

    it('should persistent when creating memo to test', async () => {
        const memo = beginCell()
            .storeAddress(Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'))
            .storeAddress(jettonMinterSrcCosmos.address)
            .storeUint(toNano(10), 128)
            .storeUint(Src.COSMOS, 32)
            .endCell()
            .bits.toString();
        console.log({ memo: Buffer.from(memo, 'hex').toString('hex').toUpperCase() });

        const memoJettonSrcTON = beginCell()
            .storeAddress(Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'))
            .storeAddress(jettonMinterSrcTon.address)
            .storeUint(toNano(10), 128)
            .storeUint(Src.TON, 32)
            .endCell()
            .bits.toString();
        console.log({ memoJettonSrcTON: Buffer.from(memoJettonSrcTON, 'hex').toString('hex').toUpperCase() });

        const memoSrcTONNative = beginCell()
            .storeAddress(Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'))
            .storeAddress(null)
            .storeUint(toNano(10), 128)
            .storeUint(Src.TON, 32)
            .endCell()
            .bits.toString();
        console.log({ memoSrcTONNative: Buffer.from(memoSrcTONNative, 'hex').toString('hex').toUpperCase() });
    });

    it('successfully mint token to the user if coming from src::cosmos', async () => {
        const relayer = await blockchain.treasury('relayer');
        await updateBlock(blockData, relayer);
        const { header, txs } = blockData;
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

        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
            Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'),
        );
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        console.log(BigInt('0x' + beginCell().storeAddress(wallet.address).endCell().hash().toString('hex')));

        const { branch: proofs, positions } = getMerkleProofs(leaves, leaves[chosenIndex]);

        const result = await bridgeAdapter.sendTx(
            relayer.getSender(),
            BigInt(height),
            decodedTxWithRawMsg,
            proofs,
            positions,
            beginCell()
                .storeBuffer(
                    Buffer.from(
                        '80002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E1830024D89866627F77B29CB2B80A032DC8624CC9DBF6C2951AD624F8A65FB48AA42BC000000000000000000000009502F9000139517D2',
                        'hex',
                    ),
                )
                .endCell(),
            toNano('6'),
        );

        expect(result.transactions).toHaveTransaction({
            op: Opcodes.verify_receipt,
            success: true,
        });

        expect((await wallet.getBalance()).amount).toBe(toNano(10));
    });

    it('successfully transfer jetton to user if coming from src::ton', async () => {
        const relayer = await blockchain.treasury('relayer');

        await updateBlock(blockSrcTONJettonData, relayer);
        const { header, txs } = blockSrcTONJettonData;
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
        const userJettonWallet = await jettonMinterSrcTon.getWalletAddress(
            Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'),
        );
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);
        const { branch: proofs, positions } = getMerkleProofs(leaves, leaves[chosenIndex]);

        console.log(
            BigInt('0x' + beginCell().storeAddress(bridgeJettonWalletSrcTon.address).endCell().hash().toString('hex')),
        );
        console.log(
            BigInt('0x' + beginCell().storeAddress(jettonMinterSrcTon.address).endCell().hash().toString('hex')),
        );

        const result = await bridgeAdapter.sendTx(
            relayer.getSender(),
            BigInt(height),
            decodedTxWithRawMsg,
            proofs,
            positions,
            beginCell()
                .storeBuffer(
                    Buffer.from(
                        '80002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E1830019DD962909A0368DB72AEF9AFD8A4058061F3E562F460A8677A48D500EE016374000000000000000000000009502F900377EADAD6',
                        'hex',
                    ),
                )
                .endCell(),
            toNano('6'),
        );

        expect(result.transactions).toHaveTransaction({
            op: Opcodes.verify_receipt,
            success: true,
        });

        expect((await wallet.getBalance()).amount).toBe(toNano(10));
        expect((await bridgeJettonWalletSrcTon.getBalance()).amount).toBe(toNano(1000000000) - toNano(10));
    });

    it('successfully transfer to user if coming from src::ton', async () => {
        const relayer = await blockchain.treasury('relayer');
        const user = await blockchain.treasury('user', { balance: 0n });
        await updateBlock(bridgeSrcNativeTonData, relayer);
        const { header, txs } = bridgeSrcNativeTonData;
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
        const userWallet = blockchain.provider(Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'));

        const { branch: proofs, positions } = getMerkleProofs(leaves, leaves[chosenIndex]);

        console.log(
            BigInt('0x' + beginCell().storeAddress(bridgeJettonWalletSrcTon.address).endCell().hash().toString('hex')),
        );
        console.log(
            BigInt('0x' + beginCell().storeAddress(jettonMinterSrcTon.address).endCell().hash().toString('hex')),
        );
        console.log(
            BigInt(
                '0x' +
                    beginCell()
                        .storeAddress(Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'))
                        .endCell()
                        .hash()
                        .toString('hex'),
            ),
        );

        const result = await bridgeAdapter.sendTx(
            relayer.getSender(),
            BigInt(height),
            decodedTxWithRawMsg,
            proofs,
            positions,
            beginCell()
                .storeBuffer(
                    Buffer.from(
                        '80002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E1820000000000000000000000012A05F2006EFD5B5AC',
                        'hex',
                    ),
                )
                .endCell(),
            toNano('6'),
        );

        expect(result.transactions).toHaveTransaction({
            op: Opcodes.verify_receipt,
            success: true,
        });

        console.log('userBalance', await user.getBalance());
        expect((await userWallet.getState()).balance).toBeGreaterThan(toNano(9));
        expect((await userWallet.getState()).balance).toBeLessThan(toNano(10)); // since its must pay gas
    });
});

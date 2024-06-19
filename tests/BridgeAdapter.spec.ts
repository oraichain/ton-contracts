import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, SendMode, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import { Opcodes as wdOpcodes } from '../wrappers/WhitelistDenom';
import { Opcodes as baOpcodes } from '../wrappers/BridgeAdapter';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import blockData from './fixtures/bridgeSrcCosmosData.json';
import blockSrcTONJettonData from './fixtures/bridgeSrcTonData.json';
import bridgeSrcNativeTonData from './fixtures/bridgeSrcNativeTonData.json';

import { BridgeAdapter, Src } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { createHash } from 'crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { getMerkleProofs } from '../wrappers/TestClient';
import { JettonWallet } from '../wrappers/JettonWallet';
import { crc32 } from '../crc32';

describe('BridgeAdapter', () => {
    let lightClientCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;

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
            validators,
            commit,
            { value: toNano('2.5') },
        );
        console.log(`blockhash:`, Opcodes.verify_block_hash);

        expect(result.transactions).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });

        console.log(Opcodes.verify_untrusted_validators);
        expect(result.transactions).toHaveTransaction({
            success: true,
            op: Opcodes.verify_untrusted_validators,
        });

        console.log('verify_sigs', Opcodes.verify_sigs);
        expect(result.transactions).toHaveTransaction({
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

        whitelistDenomCode = await compile('WhitelistDenom');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClient: SandboxContract<LightClient>;
    let bridgeAdapter: SandboxContract<BridgeAdapter>;
    let jettonMinterSrcCosmos: SandboxContract<JettonMinter>;
    let jettonMinterSrcTon: SandboxContract<JettonMinter>;
    let bridgeJettonWalletSrcTon: SandboxContract<JettonWallet>;
    let usdtMinterContract: SandboxContract<JettonMinter>;
    let usdtDeployerJettonWallet: SandboxContract<JettonWallet>;
    let usdtDeployer: SandboxContract<TreasuryContract>;
    let whitelistDenom: SandboxContract<WhitelistDenom>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        // SET UP WHITELIST DENOM
        // THIS USDT token will be used for case we want to send USDT to Oraichain from TON
        usdtDeployer = await blockchain.treasury('usdt_deployer');
        usdtMinterContract = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: usdtDeployer.address,
                    content: beginCell().storeBuffer(Buffer.from('USDT TOKEN')).endCell(),
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );
        const deployUsdtMinterResult = await usdtMinterContract.sendDeploy(usdtDeployer.getSender(), toNano('1000'));

        expect(deployUsdtMinterResult.transactions).toHaveTransaction({
            from: usdtDeployer.address,
            to: usdtMinterContract.address,
            deploy: true,
            success: true,
        });
        await usdtMinterContract.sendMint(usdtDeployer.getSender(), {
            toAddress: usdtDeployer.address,
            jettonAmount: toNano(123456),
            amount: toNano(0.5),
            queryId: 0,
            value: toNano(1),
        });
        const usdtWalletAddress = await usdtMinterContract.getWalletAddress(usdtDeployer.address);
        const usdtJettonWallet = JettonWallet.createFromAddress(usdtWalletAddress);
        usdtDeployerJettonWallet = blockchain.openContract(usdtJettonWallet);
        expect((await usdtDeployerJettonWallet.getBalance()).amount).toBe(123456000000000n);

        deployer = await blockchain.treasury('deployer');
        // SET UP WHITELIST DENOM CONTRACT
        whitelistDenom = blockchain.openContract(
            WhitelistDenom.createFromConfig(
                {
                    admin: deployer.address,
                },
                whitelistDenomCode,
            ),
        );
        const deployWhitelistResult = await whitelistDenom.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployWhitelistResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: whitelistDenom.address,
            deploy: true,
            success: true,
        });

        // SET UP LIGHT CLIENT
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
                    whitelist_denom: whitelistDenom.address,
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
        console.log('bridgeAdapterCode', bridgeAdapterCode.toBoc().toString('hex'));
        console.log('successfully deploy');
        console.log(Buffer.from('{"submit":{"data":').toString('hex'));
        const stack = await bridgeAdapter.getBridgeData();
        expect(stack.readCell().toBoc()).toEqual(beginCell().storeAddress(lightClient.address).endCell().toBoc());
        expect(stack.readCell().toBoc()).toEqual(
            beginCell().storeBuffer(Buffer.from(bridgeWasmAddress)).endCell().toBoc(),
        );
        expect(stack.readCell().toBoc()).toEqual(jettonWalletCode.toBoc());
    });

    it('should persistent when creating memo to test', async () => {
        console.log(Opcodes.verify_receipt.toString(16));
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
                        '80002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E183002C1D548B881BC9C1DBE0195EC94361DD84C6E110E5BF847DCBE3788B65B243324000000000000000000000009502F9000139517D2',
                        'hex',
                    ),
                )
                .endCell(),
            toNano('6'),
        );
        printTransactionFees(result.transactions);

        // expect(result.transactions).toHaveTransaction({
        //     op: Opcodes.verify_receipt,
        //     success: true,
        // });

        // expect((await wallet.getBalance()).amount).toBe(toNano(10));
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

        const replayTx = await bridgeAdapter.sendTx(
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

        // expect prevent exitCode
        expect(replayTx.transactions).toHaveTransaction({
            op: crc32('op::send_tx'),
            exitCode: 3200,
        });
    });

    it('Test send jetton token from ton to bridge adapter', async () => {
        let result = await whitelistDenom.sendSetDenom(deployer.getSender(), usdtMinterContract.address, true, true, {
            value: toNano(0.1),
        });
        expect(result.transactions).toHaveTransaction({
            op: wdOpcodes.setDenom,
            success: true,
        });
        result = await usdtDeployerJettonWallet.sendTransfer(usdtDeployer.getSender(), {
            fwdAmount: toNano(1),
            jettonAmount: toNano(333),
            jettonMaster: usdtMinterContract.address,
            toAddress: bridgeAdapter.address,
            value: toNano(2),
            queryId: 0,
        });
        printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            op: baOpcodes.callbackDenom,
            success: true,
        });
    });

    it('Test send jetton token from cosmos to bridge adapter', async () => {
        const sendTokenOnCosmos = async () => {
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

            let result = await bridgeAdapter.sendTx(
                relayer.getSender(),
                BigInt(height),
                decodedTxWithRawMsg,
                proofs,
                positions,
                beginCell()
                    .storeBuffer(
                        Buffer.from(
                            '80002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E183002C1D548B881BC9C1DBE0195EC94361DD84C6E110E5BF847DCBE3788B65B243324000000000000000000000009502F9000139517D2',
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
        };

        await sendTokenOnCosmos();

        const userContract = await blockchain.treasury('user', {
            balance: 0n,
        });

        await deployer.send({
            to: userContract.address,
            value: toNano(3),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        console.log('Memo', 'Yoop', (await blockchain.getContract(userContract.address)).balance);

        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
            userContract.address, // this is "user" treasury
        );
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            jettonMinterSrcCosmos.address,
            true,
            false,
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: wdOpcodes.setDenom,
            success: true,
        });

        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10000000000n);
        result = await wallet.sendTransfer(userContract.getSender(), {
            fwdAmount: toNano(1),
            jettonAmount: toNano(5),
            jettonMaster: jettonMinterSrcCosmos.address,
            toAddress: bridgeAdapter.address,
            value: toNano(2),
            queryId: 0,
        });
        printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            op: baOpcodes.callbackDenom,
            success: true,
        });
        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(5000000000n);
    });
});

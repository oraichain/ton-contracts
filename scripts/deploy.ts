import { compile } from '@ton/blueprint';
import { createTonWallet, waitSeqno } from './utils';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { BridgeAdapter, Paused } from '../wrappers/BridgeAdapter';
import { LightClientMaster } from '../wrappers/LightClientMaster';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { getSpecCell } from '../wrappers';
import { ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { TetherMinter } from '../wrappers/TetherMinter';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
    const specs = [iavlSpec, tendermintSpec];
    let cellSpecs;
    for (let i = specs.length - 1; i >= 0; i--) {
        const innerCell = getSpecCell(specs[i] as ProofSpec);
        if (!cellSpecs) {
            cellSpecs = beginCell()
                .storeRef(beginCell().endCell())
                .storeSlice(innerCell.beginParse())
                .endCell();
        } else {
            cellSpecs = beginCell()
                .storeRef(cellSpecs)
                .storeSlice(innerCell.beginParse())
                .endCell();
        }
    }

    // LIGHT CLIENT
    const lightClientMaster = client.open(
        LightClientMaster.createFromConfig(
            {
                chainId: 'Oraichain',
                lightClientCode: await compile('LightClient'),
                specs: cellSpecs!,
                trustedHeight: 0,
                trustingPeriod: 14 * 86400,
            },
            await compile('LightClientMaster'),
        ),
    );
    // await lightClientMaster.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy light client at address: ', lightClientMaster.address);

    // USDT
    const usdtMinterContract = client.open(
        TetherMinter.createFromConfig(
            {
                adminAddress: walletContract.address,
                content: beginCell()
                    .storeBuffer(Buffer.from('USDT Token'))
                    .storeBuffer(Buffer.from('USDT'))
                    .storeBuffer(Buffer.from('USDT token from Telegram OpenNetwork'))
                    .endCell(),
                jettonWalletCode: await compile('JettonWallet'),
            },
            await compile('TetherMinter'),
        ),
    );
    // await usdtMinterContract.sendDeploy(walletContract.sender(key.secretKey), {
    //     value: toNano('1'),
    // });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy usdtContract at address: ', usdtMinterContract.address);

    // await usdtMinterContract.sendMint(
    //     walletContract.sender(key.secretKey),
    //     {
    //         toAddress: walletContract.address,
    //         jettonAmount: toNano(1_000_000),
    //         amount: toNano(0.5),
    //     },
    //     { value: toNano(1), queryId: 0 },
    // );

    const whitelistContract = client.open(
        WhitelistDenom.createFromConfig(
            {
                admin: walletContract.address,
            },
            await compile('WhitelistDenom'),
        ),
    );

    await whitelistContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy whitelistContract at address: ', whitelistContract.address);

    await whitelistContract.sendSetDenom(
        walletContract.sender(key.secretKey),
        {
            denom: usdtMinterContract.address,
            isRootFromTon: true,
            permission: true,
        },
        {
            value: toNano('1'),
        },
    );
    await waitSeqno(walletContract, await walletContract.getSeqno());

    // BRIDGE ADAPTER
    // const tonBridge = BridgeAdapter.createFromAddress(
    //     Address.parse('EQArWlaBgdGClwJrAkQjQP_8zxIK_bdgbH-6qdl4f5JEfo3r'),
    // );
    // const tonBridgeContract = client.open(tonBridge);
    // await tonBridgeContract.sendUpgradeContract(
    //     walletContract.sender(key.secretKey),
    //     await compile('BridgeAdapter'),
    //     {
    //         value: toNano('0.03'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());

    const tonBridge = BridgeAdapter.createFromConfig(
        {
            light_client_master: lightClientMaster.address, // just fake it for demo
            jetton_wallet_code: Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7201021301000385000114ff00f4a413f4bcf2c80b0102016202030202cb0405001ba0f605da89a1f401f481f481a9a30201ce06070201580a0b02f70831c02497c138007434c0c05c6c2544d7c0fc07783e903e900c7e800c5c75c87e800c7e800c1cea6d0000b4c7c076cf16cc8d0d0d09208403e29fa96ea68c1b088d978c4408fc06b809208405e351466ea6cc1b08978c840910c03c06f80dd6cda0841657c1ef2ea7c09c6c3cb4b01408eebcb8b1807c073817c160080900113e910c30003cb85360005c804ff833206e953080b1f833de206ef2d29ad0d30731d3ffd3fff404d307d430d0fa00fa00fa00fa00fa00fa00300008840ff2f00201580c0d020148111201f70174cfc0407e803e90087c007b51343e803e903e903534544da8548b31c17cb8b04ab0bffcb8b0950d109c150804d50500f214013e809633c58073c5b33248b232c044bd003d0032c032481c007e401d3232c084b281f2fff274013e903d010c7e800835d270803cb8b13220060072c15401f3c59c3e809dc072dae00e02f33b51343e803e903e90353442b4cfc0407e80145468017e903e9014d771c1551cdbdc150804d50500f214013e809633c58073c5b33248b232c044bd003d0032c0325c007e401d3232c084b281f2fff2741403f1c147ac7cb8b0c33e801472a84a6d8206685401e8062849a49b1578c34975c2c070c00870802c200f1000aa13ccc88210178d4519580a02cb1fcb3f5007fa0222cf165006cf1625fa025003cf16c95005cc2391729171e25007a813a008aa005004a017a014bcf2e2c501c98040fb004300c85004fa0258cf1601cf16ccc9ed5400725269a018a1c882107362d09c2902cb1fcb3f5007fa025004cf165007cf16c9c8801001cb0527cf165004fa027101cb6a13ccc971fb0050421300748e23c8801001cb055006cf165005fa027001cb6a8210d53276db580502cb1fcb3fc972fb00925b33e24003c85004fa0258cf1601cf16ccc9ed5400eb3b51343e803e903e9035344174cfc0407e800870803cb8b0be903d01007434e7f440745458a8549631c17cb8b049b0bffcb8b0b220841ef765f7960100b2c7f2cfc07e8088f3c58073c584f2e7f27220060072c148f3c59c3e809c4072dab33260103ec01004f214013e809633c58073c5b3327b55200087200835c87b51343e803e903e9035344134c7c06103c8608405e351466e80a0841ef765f7ae84ac7cbd34cfc04c3e800c04e81408f214013e809633c58073c5b3327b5520',
                    'hex',
                ),
            )[0],
            bridge_wasm_smart_contract:
                'orai18lppnh7nwfnstpsewe70aql2qnmnm6kwkdcfe3j84ujtwzn89afqjp4pyr',
            whitelist_denom: whitelistContract.address,
            admin: walletContract.address!,
            paused: Paused.UNPAUSED,
        },
        await compile('BridgeAdapter'),
    );

    const tonBridgeContract = client.open(tonBridge);
    await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), {
        value: toNano('0.1'),
    });
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy tonBridgeContract at address: ', tonBridgeContract.address);

    const cell = (await tonBridgeContract.getBridgeData()).readCell();
    console.log(BridgeAdapter.parseBridgeDataResponse(cell));
    // const packet = await tonBridgeContract.getSendPacketCommitment(1n);
    // console.log(BigInt('0x' + packet.hash().toString('hex')));

    // This one we consider it as orai token
    // const jettonMinterSrcCosmos = client.open(
    //     JettonMinter.createFromConfig(
    //         {
    //             adminAddress: tonBridge.address,
    //             content: beginCell()
    //                 .storeBuffer(Buffer.from('ORAI Token'))
    //                 .storeBuffer(Buffer.from('ORAI'))
    //                 .storeBuffer(Buffer.from('ORAI token from Oraichain'))
    //                 .endCell(),
    //             jettonWalletCode: await compile('JettonWallet'),
    //         },
    //         await compile('JettonMinter'),
    //     ),
    // );
    // await jettonMinterSrcCosmos.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('3') });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy jettonMinterSrcCosmos at address: ', jettonMinterSrcCosmos.address);

    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('0.1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('0.1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());
}

deploy()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .then(() => {
        console.log('done');
        process.exit(0);
    });

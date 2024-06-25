import { compile } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';
import { createTonWallet, waitSeqno } from './utils';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { BridgeAdapter } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
    // LIGHT CLIENT
    const lightClient = client.open(
        LightClient.createFromConfig(
            {
                chainId: 'Oraichain',
                dataHash: '',
                height: 11111,
                nextValidatorHashSet: '',
                validatorHashSet: '',
            },
            await compile('LightClient'),
        ),
    );
    // await lightClient.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy light client at address: ', lightClient.address);

    // USDT
    // const usdtMinterContract = client.open(
    //     JettonMinter.createFromConfig(
    //         {
    //             adminAddress: walletContract.address,
    //             content: beginCell()
    //                 .storeBuffer(Buffer.from('USDT Token'))
    //                 .storeBuffer(Buffer.from('USDT'))
    //                 .storeBuffer(Buffer.from('USDT token from Telegram OpenNetwork'))
    //                 .endCell(),
    //             jettonWalletCode: await compile('JettonWallet'),
    //         },
    //         await compile('JettonMinter'),
    //     ),
    // );
    // await usdtMinterContract.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('3') });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy usdtContract at address: ', usdtMinterContract.address);

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

    // await whitelistContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy whitelistContract at address: ', whitelistContract.address);

    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());

    // console.log((await compile('UsdtJettonWallet')).toBoc().toString('hex'));
    // BRIDGE ADAPTER
    const tonBridge = BridgeAdapter.createFromConfig(
        {
            light_client: Address.parse('EQCSnxYiqpz1hiOw76klvQfPCxalze9SoGTB8ZrVDhatdYjN'),
            jetton_wallet_code: Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7241020f010003d1000114ff00f4a413f4bcf2c80b01020162020c02f8d001d0d3030171b08e48135f038020d721ed44d0d303fa00fa40fa40d104d31f01840f218210178d4519ba0282107bdd97deba12b1f2f48040d721fa003012a0401303c8cb0358fa0201cf1601cf16c9ed54e0fa40fa4031fa0031f401fa0031fa00013170f83a02d31f012082100f8a7ea5ba8e85303459db3ce033030601f203d33f0101fa00fa4021fa4430c000f2e14ded44d0d303fa00fa40fa40d15309c7052471b0c00021b1f2ad522bc705500ab1f2e0495115a120c2fff2aff82a54259070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c920f9007074c8cb02ca07cbffc9d004fa40f401fa002004019820d70b009ad74bc00101c001b0f2b19130e2c88210178d451901cb1f500a01cb3f5008fa0223cf1601cf1626fa025007cf16c9c8801801cb055004cf1670fa024063775003cb6bccccc945370500b42191729171e2f839206e938124279120e2216e94318128739101e25023a813a0738103a370f83ca00270f83612a00170f836a07381040982100966018070f837a0bcf2b0048050fb005803c8cb0358fa0201cf1601cf16c9ed5402d0228210178d4519ba8e84325adb3ce034218210595f07bcba8e843101db3ce032208210eed236d3ba8e2f30018040d721d303d1ed44d0d303fa00fa40fa40d1335142c705f2e04a403303c8cb0358fa0201cf1601cf16c9ed54e06c218210d372158cbadc840ff2f0070a03f4ed44d0d303fa00fa40fa40d12372b0c002f26d07d33f0101fa005141a004fa40fa4053bac705f82a5464e070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d0500cc7051bb1f2e04a09fa0021925f04e30d26d70b01c000b393306c33e30d550208090b0060c882107362d09c01cb1f2501cb3f5004fa0258cf1658cf16c9c8801001cb0524cf1658fa02017158cb6accc98011fb00007a5054a1f82fa07381040982100966018070f837b60972fb02c8801001cb055005cf1670fa027001cb6a8210d53276db01cb1f5801cb3fc9810082fb005901f2ed44d0d303fa00fa40fa40d106d33f0101fa00fa40f401d15141a15288c705f2e04926c2fff2afc882107bdd97de01cb1f5801cb3f01fa0221cf1658cf16c9c8801801cb0526cf1670fa02017158cb6accc903f839206e943081169fde718102f270f8380170f836a0811a7770f836a0bcf2b0028050fb00030b002003c8cb0358fa0201cf1601cf16c9ed540201200d0e0027bfd8176a2686981fd007d207d206899fc15209840021bc508f6a2686981fd007d207d2068af81c31b8493c',
                    'hex',
                ),
            )[0],
            bridge_wasm_smart_contract: 'orai1y4kj224wmzmrna4kz9nk3n00zxdst5nra0z0u0nry5k6seqdw5psu4t9fn',
            whitelist_denom: Address.parse('EQATDM6mfPZjPDMD9TVa6D9dlbmAKY5w6xOJiTXJ9Nqj_dsu'),
        },
        await compile('BridgeAdapter'),
    );

    const tonBridgeContract = client.open(tonBridge);
    await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('0.1') });
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy tonBridgeContract at address: ', tonBridgeContract.address);

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
    //         denom: jettonMinterSrcCosmos.address,
    //         isRootFromTon: false,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('1'),
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

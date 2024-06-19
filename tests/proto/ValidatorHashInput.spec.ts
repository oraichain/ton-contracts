import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as fixtures from '../fixtures/validator_hash_input.json';
import * as blockData from '../fixtures/data.json';

describe('Validator Hash Input', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let vhi: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        vhi = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await vhi.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: vhi.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(fixtures)) {
            if (fixture?.value !== undefined && fixture?.encoding !== undefined) {
                expect(
                    (await vhi.getValidatorHashInputEncode(fixture.value.pub_key, fixture.value.voting_power)).toString(
                        'hex',
                    ),
                ).toBe(fixture.encoding);
            }
        }
    });

    xit('test encode with large data', async () => {
        const encodingData = [
            '0a251624de6420fd284e309e23a18641a8f545b43d3eb24539f65061f38b80c8b92678be83a70a108dfd25',
            '0a251624de642088cbd767eced2f5681039a1102f071bc94c1354646828aaa44af884c632e869910b7ed21',
            '0a251624de6420b74b397689e844cb5edc3c5408972e35126f03bd25182e6c868ee2827fcc3e3b10db9c19',
            '0a251624de64204eacda9601e52c14fa17dc3f3a546f996c9d589f27a4743f9b589ad6ed4976e010d5ab14',
            '0a251624de64208a35d142be1fcb950d280835791f576584b096237e240782215cd7b6f0818d1e1086c913',
            '0a251624de642014ab83d3cf66cf866a372588774214cccb1d6649f290281214bb9ffce9d5d61810d4be13',
            '0a251624de64207f005420f6a0bdc38a87877a763bda63a0672cf4e3390b1f366b49dd11ae2f321082f90c',
            '0a251624de6420244562be7a9e1b2d5c4ab2bb874a9009e547ca45223dfa966bc098165fd02fe810adbe0a',
            '0a251624de6420b1f95da9d8b240ea813f8a05f23d9d2bc2613d34a23c8c9fe1a170959c3961a610cbbd0a',
            '0a251624de6420e256dc1a435394ec16827eacfe2d9e06a4f06b830c85cb775722aa50f057713610e6ee07',
            '0a251624de64202da151e3f06e0b7310b176360959e6bcc24bff5b6ac99b33cc4b620ce63f278810bceb07',
            '0a251624de6420597a914a043489be13a078e873cc5a2f2d720c1fe264134259940a60d4600d5a10b8c207',
            '0a251624de642075d397c7f078a2fdefdd0c3d80fb0f0a8383c51a84634e580496deafdc1b415f10ed9707',
            '0a251624de642013a3580b711d58fade486c2e710d6352932720514b2f265cc00ded1bb8c0853e10e6f106',
            '0a251624de6420544be3976cedb723c6ba10410601a33fabe4fe5e6693210f5abde43eb10a854a10c4cc06',
            '0a251624de64206c46b3cba075cf398fc6c253dc6d8913c60935ae2d200e122828bb0adfd827251097c306',
            '0a251624de64208d3cfd73677e04d7573ce200226805a0e8b83de33d90cf8c6da40f4dc66c1ae410a4c006',
            '0a251624de6420090df74de6ef6dffe0fd7ded4c95d828674316cc72734cf5f79c335cc26fb62010d99506',
            '0a251624de6420534b885a699b2b4d00d9f9ac5d58b66ee1b17d5697ec719a684f702141072a9a10a8c505',
            '0a251624de642068fa9b866003b2b4815c3f6a80b769b1332aa1467bcd9b9fc112bb2fe1b41d5f10c2b805',
            '0a251624de6420021c61b6baa5609bac15ac9ef270d9110952e841ee68ad4135bf0e47502dfb5510b0ab05',
            '0a251624de64201233dbec9e47ed5ab393cb92a2a3b48cc27d79d0ceeb2c651c86b0690db4489110eed104',
            '0a251624de64203a29b785031e9d1c9f10b2e52f02d1570705d48c492560fad3ef951a148f8d9e10cffd03',
            '0a251624de6420e6a29003c738af83ccead6fb70c124d29a49ebaad94d1e751159a9769bfb67c210fff903',
            '0a251624de64204c41320408172f954b6ca4833fc2f2c96c5cb57fa9c80bed570b83823fd1a1fe10c6f403',
            '0a251624de64206db33a391fd0170ae9ab3241a4c5a1385e82a24e66f1273a0d22aa6dc44080501088f003',
            '0a251624de6420769df4d93e8363d673a678b605caa6fb51b80c64bc6d160aae8d239b0b7d8f9c10f7ec03',
            '0a251624de6420005cc06771d756c2de8422fb082e0f0cf7f6471e95243e1c214602aeb6b5a3e410f1ea03',
            '0a251624de6420af7f8bba5ec0f2d523b05c1738636550277235eb9c385df06bf8e7ba986bfe84108eda03',
            '0a251624de6420d8f9f807ed509a78d18900a1bbedcad9aafce629b564bf0f58d386b28fb832d51080d203',
            '0a251624de642007c2eddb42032aad70681f6b7b8dd60c237546ae39c33e0061da7023f313200810a8b103',
            '0a251624de64208cbba779efbeefef6d3b4bd52011b9f4f386c246d284688e59bb6081364c8cc310b3a803',
            '0a251624de6420e220d745324181e26e3b537c2ec9f97900fc14d2a0f31439329f5e6f0d04e4641092d702',
            '0a251624de64206c93d978f2a4373cf757f58005e1cf55d9a7e0693ab876ead53a2ba3beaee12410cfad02',
            '0a251624de6420d1508e278141c38a8d024a769c51fff9a31c48b076b86c39ac33878820961aa310ad8802',
            '0a251624de6420ebcb13b8b8bd19b612b5965842a00c3531170166b0f8d2692f3d94cc524367bb10c3e201',
            '0a251624de6420fc6fdfd928945838ddfba3cd168bcd47e3badddaab46dd64c1f253de885e667110a566',
            '0a251624de642035814fd30234437fef2be4b882d150a8f15ef1fde632854b435f909d7fe971d210db64',
            '0a251624de642018d6690f831ba4a8330d1484414fcbe37f29730203cb038db3fe949e9860e0c910b55d',
            '0a251624de6420167bb94d517dc18fd9de51e5b74ad367a43a3429cd4e82a7b29ccc74418424ef108750',
            '0a251624de64201b45326d5de5d09c03a664b083301cb39dc9b5c4934987451416637386e9245210ce47',
            '0a251624de642032a514884865f4c404a69b2903d9d765df7bdd5436d0823bd25922f7c258df9d10ae43',
            '0a251624de64203d038e83e6c7f55d7b1db76062b4158e3f642ef32109b56e098f7e1707bc6b8210da3e',
            '0a251624de6420c3ad52c78b04123d0b8a0be5a171389c6cb4016e2680873b240299886244471810be38',
            '0a251624de6420c941a5317e5a20da26c5f471ad548e0aab1948a5980c31db681f4bae0d6fd1b210a735',
            '0a251624de64206f6e789cd436ce8cc08680489670a8b8f455716a5e4940173e6eb38b4956ad2110ae33',
            '0a251624de6420593ef2a9c1c78d874385705e21152b0201ef27cf9b2049ff53b1ff914bb00fad10fd2f',
            '0a251624de6420925af0860f9bea9518d0279b2b37c61e42f7a7a5a4e579bfb8d2c298e2fce89410f42f',
            '0a251624de642093dd339ff23fb9c63ec93ce456ab7bfae1b40ac437bdd8bdf118675fc3f16e2f10cc2f',
            '0a251624de6420d2e5f22acc0dc4bd39ca2640ce677da0ff8fa521cad9206785313f8a50f7ccf610a52d',
            '0a251624de64208108b2f9334ba3586e0f15ec43764c4dbb4fe92419d2c0aac871ee9c5137933410e82a',
            '0a251624de6420cea61dfc2958769cd510163486475b48d454261995bad7d9bbf0e3360af982c410972a',
            '0a251624de642090b73b7d5e63d1a33c318d07c39c92311c18e6ebc0872a3a513a1756c1cf894310f229',
            '0a251624de642012065c1d73ada8417d1a836055d9168fe0d08e543c9170db3d5f3896c37774f7108229',
            '0a251624de64209e6563e12fe51cb47bbfe1ae8d71d3bbeebd90e686d475e05392b93b5c37fcaf10f828',
            '0a251624de642020b7c20037b1bd87bac18af50727fa727dc427d8d607ad1e233b15f4779693b710ea28',
            '0a251624de64202f3e1a3526a28d96aa17fbc15b769cba32e76d27f7338b8e30154b36af564d6110e728',
            '0a251624de64204590a434d6d784f1f6712a37080bf5b45fd264fe0932967f0780593459ac633d10d228',
            '0a251624de6420eb3e54ed7c6cbda4a83e249d3ffde730b134042be2f0ff1cd3a1abe483c42d3010cd28',
            '0a251624de6420afe8161e32fdb14eaf532e999124c6393475cde6ecacfe8545cac258c73d6ece10c828',
            '0a251624de6420678e8778c9f5db28b855c0e5ab325f168c317487e603344cf8dd0dbe04ee8e7b10b628',
            '0a251624de6420d5376ae81700a8b1735c1aa380dc05257e80f187fe68ab2a5135bb4145277fb610b128',
            '0a251624de6420de1b4eb1b3daa3e6bcff3c9b0af11ad1cd26273958cb99ed37f01665c7dd7f84109628',
            '0a251624de6420bc086695834dc99f8668f0f54ffe6b80b3d5542fbab316c8dc30b08eb1abe1c7108528',
            '0a251624de64200140cf42bf57923f4178c49856beea3d37ffd3573d53dc70270d941e5298421510f727',
            '0a251624de642028e1d07f8bbea0f32911620a9c9e8b05cc7d1eea3e255344f95ddb5fcefeb10010d327',
            '0a251624de64207afca04ac130c39b27456ae841efbd8a7728eb56dcaa3871cafbbb9b1a41195210b027',
            '0a251624de6420e7d2cfece05af1b28a2da3a40547dae1878e7fc96ce29d43a4f505fdf633c9c710a827',
            '0a251624de6420f3b51e73e1416db2c764fdd3531d977726e90c8f9013424f578f8d0480ea2fda10a727',
            '0a251624de6420ccf25e65d2a9dcded778fac9ad83af034889f0cf18a161d5b26f6ebfcd072cc3109c27',
            '0a251624de642029503ffd35ef07c9e3973ffaa6d4db01b49b3fe7b7e5d592d1ed6d16d3d0256e109a27',
            '0a251624de64208543bcc13c93f28a48f06c08d54e693800d9d41f6d2b1a9a9849ecead9f2e7f2109827',
            '0a251624de642049b1677555d7ac5dd9aa153a6d4e6a7fbd9c7c563ca5890518ba40f3e10e562b109427',
            '0a251624de64208862d3608651874e39a7ae742589a90a7c3237cc1c1ae6978f8b216511755681108e27',
            '0a251624de6420b1bd0d6c6df279530f7df951b9a42de2c83f9308d5dbb9403c9859bc35edc7e3108927',
            '0a251624de6420b0eea251060094a91c4c611bff2f01f05d9245b6dd2674d664b65790f83c2cb9108827',
            '0a251624de6420063f8e3fb36999e2b50997cbe02e5cc1514da81d4772dbe22497ea09aa80bd3e10ac14',
            '0a251624de6420410ab37e5b492107a0605213397809ba253b227964e1f4d57ab2b36872385db110ac05',
            '0a251624de6420fe17256e995a8a9fa5bf6acef87423641ba7b64897307181f4050d19b798a24f1007',
            '0a251624de64204d25b3ef091a6cad9c3d25994f2cec702d053654a974a13fda083698f909118b1002',
            '0a251624de6420451767c6e28cebadaef8ee70816658eca8dedbf15bf498aeebf63a67330a798f1002',
            '0a251624de6420602b25b27087fd8949cdd273f4a5783d955e222603a4bda7cbc1174e4886b8051002',
            '0a251624de6420c4da58bf24f1709e7a8239c39835acb24f9148a5f9c1da33dbf8e6a634e6ec2d1001',
            '0a251624de642074bd8c47b2604173907b08ca7d8912442eacc4bfa890f9ca46f883cbc0bd19e01001',
            '0a251624de6420d2aea9fff8f42c8506bd3bb54fdf3c6ed8f472611f0bbf78449b9bdf750605db1001',
            '0a251624de64208757cbe73e2bef2c414aae11d86384c75bb0583b17685dbfccca15663df14f241001',
            '0a251624de642010b8dfde73aeda38f81c5ce9c181ccaf2e25d0c66b8d4bfb41732f0ae61ee5661001',
        ];
        for (let i = 0; i < blockData.validators.length - 1; i++) {
            const validator = blockData.validators[i];
            expect(
                (
                    await vhi.getValidatorHashInputEncode(validator.pub_key.value, parseInt(validator.voting_power))
                ).toString('hex'),
            ).toBe(encodingData[i]);
        }
    });
});

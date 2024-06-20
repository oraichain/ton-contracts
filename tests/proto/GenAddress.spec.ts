import { compile } from '@ton/blueprint';
import { lightClientConfigToCell } from '../../wrappers/LightClient';
import { contractAddress } from '@ton/core';

describe('GenAddress', () => {
    it('test', async () => {
        const data = lightClientConfigToCell({
            chainId: 'Oraichain',
            dataHash: '',
            height: 0,
            nextValidatorHashSet: '',
            validatorHashSet: '',
        });
        const code = await compile('LightClient');
        const init = { code, data };
        expect(contractAddress(0, init).toString()).toBe('EQCENE7ly1sgygm8dWhTfW44Sypu1Vzidqd5E8A_kZLLujwL');
        expect(
            contractAddress(0, {
                ...init,
                data: lightClientConfigToCell({
                    chainId: 'Oraichain',
                    dataHash: '',
                    height: 1,
                    nextValidatorHashSet: '',
                    validatorHashSet: '',
                }),
            }).toString(),
        ).toBe('EQD7WOQ3hPCSxizwkNHRNbrHqR7rA2o-4r76Iw3Omy2XuL7f');
    });
});

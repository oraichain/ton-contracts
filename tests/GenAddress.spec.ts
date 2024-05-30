import { compile } from '@ton/blueprint';
import { lightClientConfigToCell } from '../wrappers/LightClient';
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
        expect(contractAddress(0, init).toString()).toBe('EQBhiCvcPtLcH5IKn6VazG4eegdrS1ibqQ1wa-oQQOfgPtXL');
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
        ).toBe('EQBWYiPjPkENUtXygAKDxCMjVm2QCekUo1wmoN2MkNhs2LcU');
    });
});

import { beginCell } from '@ton/ton';
import { BridgeAdapterOpcodes } from '../wrappers';
import { compile } from '@ton/blueprint';

(async () => {
    const code = await compile('BridgeAdapter');
    // BOC update Contract
    console.log(
        beginCell()
            .storeUint(BridgeAdapterOpcodes.upgradeContract, 32)
            .storeUint(0, 64)
            .storeRef(code)
            .endCell()
            .toBoc()
            .toString('hex'),
    );
})();

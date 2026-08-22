/**
 * BLE bootstrap. Imported for its side effect from src/app/_layout.tsx so
 * that the concrete facade implementation is registered before any screen
 * asks for it. Nothing outside src/ble/ may import a BLE library directly
 * (§11.4, §15.1).
 */
import { BleManagerBlePlxImpl } from './BleManagerBlePlxImpl'
import { registerBleManagerFactory } from './BleManagerFacade'

registerBleManagerFactory(() => new BleManagerBlePlxImpl())

export { getBleManager } from './BleManagerFacade'

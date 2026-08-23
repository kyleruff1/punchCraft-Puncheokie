/**
 * FightCamp v1 protocol module — entry point.
 *
 * Importing this module has the SIDE EFFECT of registering the adapter with
 * the {@link ProtocolRegistry} singleton so evidence-based dispatch (§16) can
 * find it without a wiring step in each caller.
 *
 * Pure TypeScript. No RN / Expo / SQLite / BLE imports.
 */

import { getProtocolRegistry } from '@protocol/ProtocolRegistry'

import { FightCampV1Adapter } from './FightCampV1Adapter'

getProtocolRegistry().register(new FightCampV1Adapter())

export * from './FightCampV1Adapter'
export * from './FightCampV1Decoder'
export * from './FightCampV1Commands'
export * from './FightCampV1State'

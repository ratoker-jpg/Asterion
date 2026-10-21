import {getBuildingMaxLevel,getHangarCapacity} from '../src/domain/buildings/balance-v1.ts';

/** Max-level hangar (25 112): the full-hangar reference of every PR91 evidence tool. */
export const PR91_HANGAR_CAPACITY=getHangarCapacity(getBuildingMaxLevel('hangar'));
/** Matched-pair populations: just under and exactly at the full hangar. */
export const PR91_POPULATIONS=[PR91_HANGAR_CAPACITY-22,PR91_HANGAR_CAPACITY];

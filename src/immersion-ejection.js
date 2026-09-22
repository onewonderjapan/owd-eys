// Short ejection performances (water / fire / ...). One stage per playback. The stage
// owns a continuous body trajectory (lift -> carry -> release/throw -> settle); the
// director reads the eye from it and layers the user's look deltas on top. Chain
// anchors bind to the performed body and to the GLB's chain_anchor world position.
//
// 2026-09-23 night split (F1, mechanical — see docs/immersion/ejection-split-map.md):
// shared scaffolding lives in ./ejection/common.js and each style is a
// ./ejection/stage-<style>.js module exporting buildStage(ctx). This file is the
// registry; the external export surface (createEjectionStage,
// EJECTION_STYLE_DURATION) is unchanged, and unknown styles play the flush stage
// exactly as the original trailing `else` did.
import {IMMERSION_CONFIG} from './immersion-config.js';
import {createEjectionContext, finishStage} from './ejection/common.js';
import {buildStage as buildWaterStage} from './ejection/stage-water.js';
import {buildStage as buildFireStage} from './ejection/stage-fire.js';
import {buildStage as buildSpaceStage} from './ejection/stage-space.js';
import {buildStage as buildQuicksandStage} from './ejection/stage-quicksand.js';
import {buildStage as buildChandelierStage} from './ejection/stage-chandelier.js';
import {buildStage as buildBoulderStage} from './ejection/stage-boulder.js';
import {buildStage as buildBridgeStage} from './ejection/stage-bridge.js';
import {buildStage as buildFlushStage} from './ejection/stage-flush.js';

const STAGE_BUILDERS = {
 water: buildWaterStage,
 fire: buildFireStage,
 space: buildSpaceStage,
 quicksand: buildQuicksandStage,
 chandelier: buildChandelierStage,
 boulder: buildBoulderStage,
 bridge: buildBridgeStage,
 flush: buildFlushStage,
};

export function createEjectionStage({actors, targetId, playerActorId, style, config, props}) {
 const ctx = createEjectionContext({actors, targetId, playerActorId, style, config, props});
 return finishStage(ctx, STAGE_BUILDERS[style] ?? buildFlushStage);
}

export const EJECTION_STYLE_DURATION = style => (IMMERSION_CONFIG.timings[style] ?? IMMERSION_CONFIG.timings.water);

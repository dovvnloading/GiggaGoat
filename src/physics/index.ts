/** Public physics lane API. No dependencies on other Gigga-Goat lanes. */
export { default as RAPIER } from '@dimforge/rapier3d-compat';
export { PhysicsWorld } from './PhysicsWorld';
export type {
  PhysicsWorldOptions, PhysicsStepResult, QueryOptions, BodyRecord, Transform, RayHit, ShapeHit,
} from './PhysicsWorld';
export { CollisionLayer, ALL_COLLISION_LAYERS, collisionGroups, groupMask,
  GROUND_QUERY_GROUPS } from './CollisionGroups';
export type { CollisionGroupName, GroupSelection } from './CollisionGroups';
export { GoatRagdoll, GOAT_SIZES } from './GoatRagdoll';
export type { GoatOptions, GoatSize, GoatPose, GoatPart, MotorTuning } from './GoatRagdoll';
export { BalanceController, LocomotionController } from './Controllers';
export type { BalanceTuning, MovementInput, LocomotionTuning, StaminaRates } from './Controllers';
export { GoatInteractions, applyExplosion, applyImpulseAt } from './Interactions';
export type { InteractionTuning, KnockedBody } from './Interactions';
export { PhysicsEventBus } from './events';
export type { PhysicsContact, PhysicsEvent } from './events';
export { V, Q, add, sub, mul, dot, cross, length, distance, normalize,
  clamp, rotate, forward, right } from './math';
export type { Vec3, Quat } from './math';
